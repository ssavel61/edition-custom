// Private episode inputs stay out of the theme, Ghost and public responses.
// EPISODE_RELEASES is a deployment-controlled JSON manifest, never user input.
export const PUBLIC_CATALOG = 'https://eaol-episode-catalog.mindovermoney-ai.workers.dev/catalog';
const MODEL = '@cf/baai/bge-base-en-v1.5';
const HEX = /^[a-f0-9]{64}$/;
export const MAX_BODY = 300000;
export const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(x => x.toString(16).padStart(2, '0')).join('');
export function releases(env) {
  const list = JSON.parse(env.EPISODE_RELEASES || '[]');
  if (!Array.isArray(list) || list.length > 24) throw Error('invalid_authority');
  const seen = new Set();
  for (const r of list) {
    if (!/^ep\d{3}$/.test(r.episodeId) || seen.has(r.episodeId) || !/^[\w-]{11}$/.test(r.videoId) ||
        !HEX.test(r.transcriptSha256) || !HEX.test(r.mediaSha256) || !r.approvalId ||
        r.status !== 'approved' || typeof r.enabled !== 'boolean' || r.coverage !== 'program_only' ||
        !Number.isInteger(r.chunkCount) || r.chunkCount < 1 || r.chunkCount > 256) throw Error('invalid_authority');
    seen.add(r.episodeId);
  }
  return list;
}
export const namespace = r => `eaol-${r.episodeId}-${r.transcriptSha256.slice(0,32)}`;
export const ids = r => Array.from({length:r.chunkCount}, (_,i) => `${namespace(r)}-${i}`);
const readyKey = r => `episode-ready:${r.episodeId}:${r.transcriptSha256}`;
const pendingKey = r => `episode-pending:${r.episodeId}:${r.transcriptSha256}`;
export async function boundedText(body, limit=MAX_BODY) {
  if (!body) throw Error('empty_body');
  const reader=body.getReader(); const parts=[]; let bytes=0;
  try { while (true) { const {done,value}=await reader.read(); if(done)break; bytes+=value.byteLength;
    if(bytes>limit) { await reader.cancel(); throw Error('body_too_large'); } parts.push(value); } }
  finally { reader.releaseLock(); }
  const joined=new Uint8Array(bytes); let at=0; for(const p of parts) { joined.set(p,at); at+=p.length; }
  return new TextDecoder('utf-8',{fatal:true}).decode(joined);
}
export async function publicEpisodes(env) {
  const response=await env.EPISODE_CATALOG.fetch(PUBLIC_CATALOG,{redirect:'manual',headers:{'Cache-Control':'no-cache','Origin':'https://www.mindovermoney.ai','User-Agent':'EAOL-Neura-Verification/1.0'},signal:AbortSignal.timeout(8000)});
  if(!response.ok) throw Error('catalog_unavailable');
  const body=JSON.parse(await boundedText(response.body,200000));
  if(body.schema!=='eaol-public-catalog-v1' || !Array.isArray(body.episodes)) throw Error('catalog_invalid');
  return body.episodes;
}
function publicMatch(r, list) {
  const matches=list.filter(e=>e.episodeId===r.episodeId);
  const e=matches[0];
  if(matches.length!==1 || e.platforms?.youtube!==`https://www.youtube.com/watch?v=${r.videoId}` ||
     typeof e.title!=='string' || e.title.length>250 || !Number.isFinite(Date.parse(e.publishedAt)) || Date.parse(e.publishedAt)>Date.now()) return null;
  return e;
}
// Preserve program words and speaker labels; omit old editorial heading and narration placeholders.
export function chunkProgram(source) {
  const pattern=/^\*\*(\d{2}):(\d{2}):(\d{2}) — (Host [12]):\*\* (.+)$/gm;
  const cues=[...source.matchAll(pattern)].map(m=>({start:Number(m[1])*3600+Number(m[2])*60+Number(m[3]),text:`${m[4]}: ${m[5]}`}));
  if(!cues.length || cues.length>5000) throw Error('invalid_program');
  const chunks=[]; let text='',start=0, previous=-1;
  for(const cue of cues) {
    if(cue.start<previous || cue.text.length>1500) throw Error('invalid_cue'); previous=cue.start;
    if(text && text.length+cue.text.length+1>1500) { chunks.push({text,start}); text=''; }
    if(!text) start=cue.start;
    text+=(text?'\n':'')+cue.text;
  }
  if(text) chunks.push({text,start});
  if(chunks.length>256) throw Error('too_many_chunks');
  return chunks;
}
export async function authenticate(request, env, secretName = "INGEST_SECRET") {
  const supplied=request.headers.get('x-ingest-secret');
  if(!env[secretName] || !supplied || supplied.length>500) return false;
  const a=await hash(supplied),b=await hash(env[secretName]); let different=0;
  for(let i=0;i<a.length;i++) different|=a.charCodeAt(i)^b.charCodeAt(i);
  return different===0;
}
export async function ingestEpisode(body, env) {
  const r=releases(env).find(r=>r.episodeId===body.episodeId);
  if(!r || typeof body.transcript!=='string' || await hash(body.transcript)!==r.transcriptSha256 || body.mediaSha256!==r.mediaSha256) throw Error('unapproved_input');
  const e=publicMatch(r,await publicEpisodes(env)); if(!e) throw Error('not_public');
  const chunks=chunkProgram(body.transcript);
  if(chunks.length!==r.chunkCount) throw Error('chunk_count_mismatch');
  const chunkHashes=await Promise.all(chunks.map(c=>hash(c.text)));
  // An identical retry is safe and cannot alter an already activated revision.
  const ready=await env.CATALOG.get(readyKey(r),'json');
  if(ready?.transcriptSha256===r.transcriptSha256 && ready?.count===r.chunkCount) return {status:'already_ready',episodeId:r.episodeId,count:r.chunkCount};
  const mutations=[];
  for(let i=0;i<chunks.length;i+=25) {
    const batch=chunks.slice(i,i+25);
    const vectors=await env.AI.run(MODEL,{text:batch.map(c=>`Explore AI Out Loud Episode ${Number(r.episodeId.slice(2))}: ${e.title}\n\n${c.text}`)});
    if(!Array.isArray(vectors.data) || vectors.data.length!==batch.length || vectors.data.some(v=>v.length!==768 || v.some(x=>!Number.isFinite(x)))) throw Error('invalid_embeddings');
    const result=await env.VECTORIZE.upsert(batch.map((c,j)=>({id:ids(r)[i+j],namespace:namespace(r),values:vectors.data[j],metadata:{
      sourceKind:'episode',episodeId:r.episodeId,transcriptSha256:r.transcriptSha256,chunkSha256:chunkHashes[i+j],
      text:c.text,start:c.start,type:'Explore AI Out Loud',title:e.title,url:e.platforms.youtube,published_at:e.publishedAt
    }})));
    mutations.push(result.mutationId || 'legacy_upsert');
  }
  await env.CATALOG.put(pendingKey(r),JSON.stringify({transcriptSha256:r.transcriptSha256,chunkHashes,mutations}));
  return {status:'pending_verification',episodeId:r.episodeId,count:chunks.length,mutations};
}
export async function verifyEpisode(body,env) {
  const r=releases(env).find(r=>r.episodeId===body.episodeId && r.transcriptSha256===body.transcriptSha256);
  if(!r || !publicMatch(r,await publicEpisodes(env))) throw Error('not_public_or_approved');
  const pending=await env.CATALOG.get(pendingKey(r),'json');
  if(!pending || pending.chunkHashes?.length!==r.chunkCount) throw Error('no_pending_revision');
  const expected=ids(r), all=[];
  for(let i=0;i<expected.length;i+=20) all.push(...await env.VECTORIZE.getByIds(expected.slice(i,i+20)));
  const byId=new Map(all.map(v=>[v.id,v]));
  for(let i=0;i<expected.length;i++) {
    const v=byId.get(expected[i]);
    if(!v || v.namespace!==namespace(r) || v.metadata?.transcriptSha256!==r.transcriptSha256 ||
       v.metadata?.episodeId!==r.episodeId || await hash(v.metadata.text)!==pending.chunkHashes[i]) throw Error('vectors_not_ready');
  }
  // Probe similarity lookup too: getByIds alone is not query-readiness proof.
  const probe=await env.VECTORIZE.query(all[0].values,{namespace:namespace(r),topK:1,returnMetadata:env.VECTORIZE_METADATA_MODE==='all'?'all':true});
  if(!probe.matches?.some(v=>expected.includes(v.id) && v.metadata?.transcriptSha256===r.transcriptSha256)) throw Error('query_not_ready');
  await env.CATALOG.put(readyKey(r),JSON.stringify({transcriptSha256:r.transcriptSha256,count:r.chunkCount,verifiedAt:new Date().toISOString()}));
  return {status:'ready',episodeId:r.episodeId,count:r.chunkCount,coverage:r.coverage};
}
export function scopeOf(query) {
  const topic=/podcast|explore\s+ai\s+out\s+loud|\beaol\b|\bepisode\b/i.test(query);
  const numeric=query.match(/\b(?:episode|ep)\s*0*(\d{1,3})\b/i);
  const ordinal=query.match(/\b(first|second|third|fourth|fifth)\s+episode\b/i);
  const number=numeric?Number(numeric[1]):ordinal?['first','second','third','fourth','fifth'].indexOf(ordinal[1].toLowerCase())+1:null;
  return {topic,episodeId:number?`ep${String(number).padStart(3,'0')}`:null};
}
export function isDump(query) {
  return /\b(transcript|verbatim|word.for.word|every\s+(?:word|line)|all\s+(?:the\s+)?(?:chunks|excerpts))\b/i.test(query) &&
    /\b(full|entire|complete|all|dump|export|download|reconstruct|verbatim|word.for.word|every)\b/i.test(query);
}
// Combine exact subject terms with semantic similarity inside approved episode scope.
// Widening the candidate pool avoids the repeated episode title dominating specific questions.
export function rankEpisodeMatches(query,matches) {
  const stop=new Set('a an and are as at be been by can did do does each for from had has have how i in is it me my of on or our out the their them there these they this to us was we were what when where which who why with you your episode first second third explore ai loud eaol santosh brandon host about'.split(' '));
  const words=text=>(text.toLowerCase().match(/[a-z]{3,}/g)||[]).filter(w=>!stop.has(w));
  const terms=[...new Set(words(query))];if(!terms.length)return matches;
  const documents=matches.map(m=>new Set(words(m.metadata?.text||'')));
  const weights=terms.map(t=>1+Math.log(1+matches.length/(1+documents.filter(d=>d.has(t)).length)));
  const total=weights.reduce((a,b)=>a+b,0);
  return matches.map((m,i)=>({...m,score:0.5*(m.score||0)+0.5*terms.reduce((sum,t,j)=>sum+(documents[i].has(t)?weights[j]:0),0)/total})).sort((a,b)=>b.score-a.score);
}
export async function episodeContext(query,vector,env) {
  const scope=scopeOf(query), configured=releases(env).filter(r=>r.enabled);
  if(!configured.length) return {matches:[],catalog:'No podcast transcripts are active.',scope};
  let current;
  try { current=await publicEpisodes(env); } catch { return {matches:[],catalog:'Podcast availability cannot currently be verified. Do not use older announcement excerpts as episode evidence.',scope}; }
  const active=[];
  for(const r of configured) {
    const e=publicMatch(r,current); if(!e)continue;
    const ready=await env.CATALOG.get(readyKey(r),'json');
    if(ready?.transcriptSha256===r.transcriptSha256 && ready?.count===r.chunkCount) active.push({r,e});
  }
  const catalog=['PODCAST TRANSCRIPTS — approved published program conversations. Opening and closing narration are not covered.',...active.map(({r,e})=>`${r.episodeId}: ${e.title} (${e.publishedAt.slice(0,10)})`)].join('\n');
  const chosen=scope.episodeId?active.filter(({r})=>r.episodeId===scope.episodeId):active;
  const results=await Promise.all(chosen.map(async({r,e})=>{
    const result=await env.VECTORIZE.query(vector,{namespace:namespace(r),topK:scope.topic?Math.min(50,r.chunkCount):2,returnMetadata:env.VECTORIZE_METADATA_MODE==='all'?'all':true});
    const valid=(result.matches || []).filter(m=>ids(r).includes(m.id) && m.metadata?.episodeId===r.episodeId && m.metadata?.transcriptSha256===r.transcriptSha256)
      .map(m=>({...m,metadata:{...m.metadata,title:e.title,url:e.platforms.youtube,type:'Explore AI Out Loud'}}));
    return scope.topic?rankEpisodeMatches(query,valid):valid;
  }));
  return {matches:results.flat().sort((a,b)=>b.score-a.score).slice(0,5),catalog,scope};
}

import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';
import worker from '../src/index.js';
import {directoryAnswer,SHOW_LINKS} from '../src/directory.js';
for(const q of ['where can i access the podcast ?','Where can I watch Explore AI Out Loud?','Where can I listen?','Is the podcast on Spotify?','Give me the podcast links and socials','Your Apple Podcasts link please']) {
 test('verified show links: '+q,async()=>{
  const result=directoryAnswer(q);assert.ok(result);assert.equal(result.sources.length,6);
  const response=await worker.fetch(new Request('https://fixture/chat',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:q}]})}),{ALLOWED_ORIGIN:'https://www.mindovermoney.ai',AI:{run(){throw Error('Must not use model or embeddings');}}});
  assert.equal(response.status,200);const s=await response.text();assert.match(s,/event: done/);
  for(const l of SHOW_LINKS)assert.ok(s.includes(l.url));
  assert.doesNotMatch(s,/KrJ5fFNxhqE|transcript excerpt|don't have specific/);
 });
}
for(const q of ['Where are your socials?','What is your Instagram?','Give me the TikTok link','Are you on TikTok?'])test('social links: '+q,()=>{const r=directoryAnswer(q);assert.equal(r.sources.length,2);assert.ok(r.sources.some(l=>l.url==='https://www.tiktok.com/@exploreaioutloud'));});
test('platform follow-up retains show context',()=>{assert.equal(directoryAnswer('And Spotify?','Where can I access the podcast?').sources.length,6);assert.equal(directoryAnswer('And Instagram?','Where can I access the podcast?').sources.length,2);});
for(const q of ['What is the first episode about?','What did they say about Spotify?','How did they build the podcast?','How can I subscribe to Neural Gains Weekly?','Where can I find the Joe Rogan podcast?','Explain social media algorithms'])test('preserves content/other-topic routing: '+q,()=>assert.equal(directoryAnswer(q),null));
test('widget renders all six navigation links and retains four-source article limit',()=>{
 const template=fs.readFileSync(new URL('../../edition-clean/partials/chat-widget.hbs',import.meta.url),'utf8');
 const fn=template.slice(template.indexOf('  function renderSources('),template.lastIndexOf('})();'));
 const el=(tag,text)=>({tag,text,children:[],appendChild(c){this.children.push(c);}});
 const context={el,document:{createElement:tag=>el(tag)},body:{scrollTop:0,scrollHeight:100}};vm.createContext(context);vm.runInContext(fn,context);
 const nav=el('div');context.renderSources(nav,directoryAnswer('Where can I access the podcast?').sources);
 assert.equal(nav.children[0].children[0].text,'Links');assert.equal(nav.children[0].children.length,7);
 assert.deepEqual(nav.children[0].children.slice(1).map(x=>x.href),SHOW_LINKS.map(l=>l.url));
 const article=el('div');context.renderSources(article,Array.from({length:6},()=>({title:'Article',url:'https://example.test'})));
 assert.equal(article.children[0].children[0].text,'Sources');assert.equal(article.children[0].children.length,5);
});

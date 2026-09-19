import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const KEY='mom-neura-session-v1';
const script=fs.readFileSync(new URL('../../edition-clean/partials/chat-widget.hbs',import.meta.url),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.handlers={};this.value='';this.style={};this.scrollHeight=100;this.scrollTop=0;this._text='';this._html='';const classes=new Set();this.classList={add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k),toggle:(k,on)=>on?classes.add(k):classes.delete(k)};}
 get childNodes(){return this.children;}get firstChild(){return this.children[0];}get lastChild(){return this.children.at(-1);}
 set textContent(s){this._text=s;this._html='';this.children=[];}get textContent(){return this._text+this._html+this.children.map(c=>c.textContent).join('');}
 set innerHTML(s){this._html=s;this._text='';this.children=[];}get innerHTML(){return this._html;}
 appendChild(c){c.parentNode=this;this.children.push(c);return c;}addEventListener(ev,fn){(this.handlers[ev]??=[]).push(fn);}fire(ev,e={}){for(const fn of this.handlers[ev]||[])fn(e);}focus(){}
}
const sse=(text='Answer',sources=[])=>`event: sources\ndata: ${JSON.stringify(sources)}\n\nevent: token\ndata: ${JSON.stringify(text)}\n\nevent: done\ndata: {}\n\n`;
function page(storage=new Map(),fetcher=async()=>new Response(sse()),denied=false){
 const ids=Object.fromEntries(['launcher','panel','body','text','send','close','reset'].map(k=>['mom-chat-'+k,new Element()]));
 const events={},document={getElementById:k=>ids[k],createElement:t=>new Element(t),addEventListener:(e,f)=>events[e]=f,visibilityState:'visible'};
 const window={sessionStorage:{getItem:k=>{if(denied)throw Error('denied');return storage.get(k)||null;},setItem:(k,v)=>{if(denied)throw Error('quota');storage.set(k,v);},removeItem:k=>storage.delete(k)},addEventListener:(e,f)=>events[e]=f};
 const calls=[];vm.runInNewContext(script,{document,window,URL,TextEncoder,TextDecoder,AbortController,setTimeout,clearTimeout,fetch:async(u,o)=>{calls.push(JSON.parse(o.body));return fetcher(u,o);}});
 return {ids,window,events,calls,storage,state:()=>JSON.parse(storage.get(KEY)),ask:q=>{ids['mom-chat-text'].value=q;ids['mom-chat-send'].fire('click');},text:()=>ids['mom-chat-body'].textContent};
}
const flush=async()=>{await new Promise(r=>setTimeout(r,10));};
test('navigation restores messages, six links, open panel, draft and completed follow-up context',async()=>{
 const links=Array.from({length:6},(_,i)=>({title:'Link '+i,url:'https://example.com/'+i,kind:'navigation'}));const a=page(new Map(),async()=>new Response(sse('First answer',links)));a.window.MindOverMoneyChat.open();a.ask('First question');await flush();a.ids['mom-chat-text'].value='Unsent draft';a.events.pagehide();
 const b=page(a.storage);assert.ok(b.text().includes('First answer'));assert.ok(b.text().includes('Link 5'));assert.equal(b.ids['mom-chat-text'].value,'Unsent draft');assert.ok(b.ids['mom-chat-panel'].classList.contains('open'));assert.equal(b.calls.length,0);
 b.ask('Follow up');await flush();assert.deepEqual(b.calls[0].messages,[{role:'user',content:'First question'},{role:'assistant',content:'First answer'},{role:'user',content:'Follow up'}]);
 b.window.MindOverMoneyChat.close();const c=page(b.storage);assert.equal(c.ids['mom-chat-panel'].classList.contains('open'),false);
});
test('navigation during a reply preserves partial text; restore does not send; retry is explicit',async()=>{
 let ctl;const a=page(new Map(),async()=>new Response(new ReadableStream({start(c){ctl=c;c.enqueue(new TextEncoder().encode('event: token\ndata: "Partial reply"\n\n'));}})));a.ask('Slow question');await flush();a.events.pagehide();assert.equal(a.state().messages[1].status,'interrupted');
 const b=page(a.storage);assert.match(b.text(),/Partial reply/);assert.match(b.text(),/interrupted/);assert.equal(b.calls.length,0);b.ids['mom-chat-body'].lastChild.children.find(c=>c.tag==='button').fire('click');await flush();assert.equal(b.calls.length,1);assert.deepEqual(b.calls[0].messages,[{role:'user',content:'Slow question'}]);assert.equal(b.state().messages[1].status,'complete');ctl.close();
});
test('interrupted assistant content is not sent as completed history',async()=>{
 const saved={version:1,open:true,draft:'',messages:[{role:'user',content:'Old question',status:'complete'},{role:'assistant',content:'Partial',status:'pending'}]};const a=page(new Map([[KEY,JSON.stringify(saved)]]));a.ask('New question');await flush();assert.deepEqual(a.calls[0].messages,[{role:'user',content:'New question'}]);
});
test('new chat clears messages and draft and invalidates late response callbacks',async()=>{
 let resolve;const a=page(new Map(),()=>new Promise(r=>resolve=r));a.ask('Old');a.ids['mom-chat-text'].value='draft';a.ids['mom-chat-reset'].fire('click');resolve(new Response(sse('Late old answer')));await flush();assert.equal(a.state().messages.length,0);assert.equal(a.state().draft,'');assert.doesNotMatch(a.text(),/Late old answer/);assert.equal(a.ids['mom-chat-send'].disabled,false);
});
test('corrupt or denied storage keeps a usable chat',async()=>{for(const [map,denied] of [[new Map([[KEY,'{bad']]),false],[new Map(),true]]){const a=page(map,async()=>new Response(sse()),denied);a.ask('Hello');await flush();assert.match(a.text(),/Answer/);}});
test('restored markup is escaped and unsafe source URLs are removed',()=>{
 const saved={version:1,open:true,messages:[{role:'user',content:'<img onerror=evil()>',status:'complete'},{role:'assistant',content:'<script>evil()</script>',status:'complete',sources:[{title:'Bad',url:'javascript:evil()'},{title:'Good',url:'https://example.com'}]}]};const a=page(new Map([[KEY,JSON.stringify(saved)]]));assert.match(a.text(),/&lt;script&gt;/);assert.doesNotMatch(a.text(),/Bad|<script>/);assert.match(a.text(),/Good/);
});
test('stream without done is incomplete and excluded from follow-up context',async()=>{const a=page(new Map(),async()=>new Response('event: token\ndata: "Partial"\n\n'));a.ask('Question');await flush();assert.equal(a.state().messages[1].status,'error');a.ask('Next');await flush();assert.equal(a.calls[1].messages.length,1);});
test('back-forward cache restores the newest session rather than stale page state',async()=>{const a=page();a.ask('Old');await flush();a.events.pagehide();const b=page(a.storage);b.ids['mom-chat-reset'].fire('click');a.events.pageshow({persisted:true});assert.equal(a.state().messages.length,0);assert.doesNotMatch(a.text(),/Old/);});
test('recent history is bounded on disk and outgoing unicode bytes fit Worker limit',async()=>{
 const messages=Array.from({length:20},()=>[{role:'user',content:'Question',status:'complete'},{role:'assistant',content:'😀'.repeat(4000),status:'complete'}]).flat();const a=page(new Map([[KEY,JSON.stringify({version:1,open:true,draft:'',messages})]]));a.ask('😀'.repeat(1000));await flush();assert.ok(new TextEncoder().encode(JSON.stringify(a.calls[0])).length<=22000);assert.equal(a.calls[0].messages.length,3);assert.equal(a.state().messages.length,40);assert.ok(a.storage.get(KEY).length<=250000);
});

import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';import {parseHTML} from 'linkedom';
const html=readFileSync(new URL('../src/ui/player.html',import.meta.url),'utf8'),script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
async function fixture({message=true}={}){
 const {document}=parseHTML(html),events=new Map(),sent=[],timers=new Map();let seq=0;
 const parent={postMessage(m){sent.push(m);}},window={parent,addEventListener(name,fn){events.set(name,fn);}};
 runInNewContext(script,{window,document,URL,console,setTimeout(fn){timers.set(++seq,fn);return seq;},clearTimeout(id){timers.delete(id);}});
 const emit=data=>events.get('message')({source:parent,data:{jsonrpc:'2.0',...data}});
 const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
 const init=sent.find(m=>m.method==='ui/initialize');emit({id:init.id,result:{hostCapabilities:{message:message?{text:{}}:{}},hostContext:{}}});await flush();
 const read=sent.find(m=>m.method==='tools/call');assert.ok(read);
 const song={trackId:'123',title:'Track <script>evil</script>',artists:[{name:'Artist'}],coverUrl:'https://evil.test/image.jpg',playing:true,liked:false,trackKey:'a'.repeat(24),lyrics:[],durationSeconds:242};
 emit({id:read.id,result:{structuredContent:{result:song}}});await flush();
 return{document,sent,emit,flush,song,timers,events,parent};
}
test('card renders safe text and disables follow-up when host does not advertise messages',async()=>{
 const f=await fixture({message:false});assert.equal(f.document.getElementById('title').textContent,f.song.title);assert.equal(f.document.getElementById('cover').hasAttribute('src'),false);assert.equal(f.document.getElementById('send').disabled,true);assert.match(f.document.getElementById('lyrics').textContent,/暂无歌词/);
});
test('follow-up submits once with the clicked song identity and preserves newer input',async()=>{
 const f=await fixture(),input=f.document.getElementById('message'),form=f.document.getElementById('message-form');input.value='请推荐类似的音乐';form.onsubmit({preventDefault(){}});form.onsubmit({preventDefault(){}});
 const messages=f.sent.filter(m=>m.method==='ui/message');assert.equal(messages.length,1);assert.equal(messages[0].params.role,'user');assert.match(messages[0].params.content[0].text,/"trackId":"123"/);
 input.value='newer draft';f.emit({id:messages[0].id,result:{}});await f.flush();assert.equal(input.value,'newer draft');assert.match(f.document.getElementById('status').textContent,/已提交/);
});
test('unrelated tool notifications do not erase the song and uncertain sends are not replayed',async()=>{
 const f=await fixture();f.emit({method:'ui/notifications/tool-result',params:{structuredContent:{result:{verified:true,state:{playing:false}}}}});assert.equal(f.document.getElementById('title').textContent,f.song.title);
 const input=f.document.getElementById('message'),form=f.document.getElementById('message-form');input.value='换首歌';form.onsubmit({preventDefault(){}});
 const last=[...f.timers.values()].at(-1);last();await f.flush();assert.equal(f.document.getElementById('send').disabled,true);assert.equal(input.value,'换首歌');form.onsubmit({preventDefault(){}});assert.equal(f.sent.filter(m=>m.method==='ui/message').length,1);
});

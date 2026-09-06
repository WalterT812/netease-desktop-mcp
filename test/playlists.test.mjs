import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaylistController } from '../src/playlists.mjs';

const initial=()=>({accountId:'9',created:[{id:'10',title:'Keep',trackCount:2,updateTime:1,owned:true,system:false},{id:'11',title:'Remove',trackCount:3,updateTime:1,owned:true,system:false}],collected:[{id:'20',title:'Collected',trackCount:5}],system:{id:'1',title:'Liked',trackCount:8}});
function fixture(options={}) {
 let state=initial();const calls=[];
 const adapter={async playlistRun(action,args){calls.push({action,args});if(action==='delete'){state.created=state.created.filter(p=>p.id!==args.expected.id);return {dispatched:true};}return structuredClone(state);}};
 const controller=new PlaylistController(adapter,{enabled:true,protectedIds:['10'],...options});
 return {controller,adapter,calls,get state(){return state;}};
}
test('playlist deletion is disabled by default',async()=>{
 const {adapter}=fixture();const c=new PlaylistController(adapter);
 await assert.rejects(c.prepareDelete('11','Remove'),/PLAYLIST_DELETE_DISABLED/);
});
test('collected, system and locally protected playlists cannot receive a deletion token',async()=>{
 const {controller,calls}=fixture();
 for(const [id,name] of [['10','Keep'],['20','Collected'],['1','Liked']])await assert.rejects(controller.prepareDelete(id,name),/PROTECTED_PLAYLIST|NOT_OWNED_PLAYLIST/);
 assert.ok(calls.every(c=>c.action!=='delete'));
});
test('preview requires exact current name and ownership',async()=>{
 const f=fixture();await assert.rejects(f.controller.prepareDelete('11','Wrong'),/PLAYLIST_CHANGED/);
 f.state.created[1].owned=false;await assert.rejects(f.controller.prepareDelete('11','Remove'),/NOT_OWNED_PLAYLIST/);
});
test('changed track count or account invalidates a prepared delete without mutation',async()=>{
 for(const mutate of [s=>s.created[1].trackCount++,s=>s.accountId='another']){
  const f=fixture();const p=await f.controller.prepareDelete('11','Remove');mutate(f.state);
  await assert.rejects(f.controller.deletePrepared(p.deleteToken),/PLAYLIST_CHANGED/);
  assert.ok(f.calls.every(c=>c.action!=='delete'));
 }
});
test('a token deletes only its bound ID once and checks retained collections and liked playlist',async()=>{
 const f=fixture();const p=await f.controller.prepareDelete('11','Remove');const r=await f.controller.deletePrepared(p.deleteToken);
 assert.equal(r.verified,true);assert.equal(r.deleted.id,'11');assert.equal(f.state.system.trackCount,8);
 assert.deepEqual(f.state.collected.map(x=>x.id),['20']);
 await assert.rejects(f.controller.deletePrepared(p.deleteToken),/INVALID_DELETE_TOKEN/);
 assert.equal(f.calls.filter(c=>c.action==='delete').length,1);
});
test('uncertain dispatch consumes the token and blocks a new preview for that ID',async()=>{
 const f=fixture();const run=f.adapter.playlistRun;
 f.adapter.playlistRun=async(action,args)=>{if(action==='delete')throw new Error('CDP_TIMEOUT');return run(action,args);};
 const p=await f.controller.prepareDelete('11','Remove');await assert.rejects(f.controller.deletePrepared(p.deleteToken),/CDP_TIMEOUT/);
 await assert.rejects(f.controller.deletePrepared(p.deleteToken),/INVALID_DELETE_TOKEN/);
 await assert.rejects(f.controller.prepareDelete('11','Remove'),/DELETE_OUTCOME_UNKNOWN/);
});
test('an expired preview cannot delete',async()=>{
 const f=fixture({ttlMs:-1});const p=await f.controller.prepareDelete('11','Remove');
 await assert.rejects(f.controller.deletePrepared(p.deleteToken),/EXPIRED_DELETE_TOKEN/);
 assert.ok(f.calls.every(c=>c.action!=='delete'));
});
test('post-delete changes to protected collections are not reported as success',async()=>{
 const f=fixture();const run=f.adapter.playlistRun;
 f.adapter.playlistRun=async(action,args)=>{const r=await run(action,args);if(action==='delete')f.state.collected=[];return r;};
 const p=await f.controller.prepareDelete('11','Remove');await assert.rejects(f.controller.deletePrepared(p.deleteToken),/PRESERVATION_CHECK_FAILED/);
});

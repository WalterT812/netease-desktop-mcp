import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {playerBridge} from '../src/player-bridge.mjs';
import {attachContracts,playingFactory} from './a526397-contract-fixture.mjs';
function fixture(){
 const calls=[],state={playing:{playingMode:'playOrder',playingVolume:.56},'async:listenTogether':{status:'alone'}};
 const loader={m:{},c:{}};attachContracts(loader);
 const chunks=[];chunks.push=function(p){Array.prototype.push.call(this,p);const [id,fn]=Object.entries(p[1])[0];loader.m[id]=fn;loader.c[id]={};fn({}, {}, loader);};
 const store={getState:()=>state,dispatch:p=>{calls.push(p)}};
 const document={scripts:[{src:'orpheus://orpheus/pub/hybrid/app.chunk.a526397.js'}],querySelector:()=>({__reactFiber$test:{memoizedProps:{value:{store}}}}),querySelectorAll:()=>[]};
 const run=(action,args={})=>runInNewContext(`(${playerBridge.toString()})(action,args)`,{action,args,document,window:{webpackJsonp:chunks},URL});
 return {run,calls,state,loader,chunks,document};
}
test('a526397 volume uses one native volume dispatch, no play or UI action',()=>{
 const f=fixture();f.run('volume',{percent:30});
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[{type:'playing/setVolume',payload:{volume:.3}}]);assert.equal(f.chunks.length,0);
 assert.throws(()=>f.run('cycleMode',{expectedMode:'playOrder'}),/UNSUPPORTED_CONTROL_LAYOUT/);assert.equal(f.calls.length,1);
});
test('background mode checks expected ordinary mode and alone state before dispatch',async()=>{
 const f=fixture();await f.run('mode',{mode:'playRandom',expectedMode:'playOrder'});assert.equal(f.calls.length,1);assert.equal(f.calls[0].type,'playing/switchPlayingMode');
 f.calls.length=0;assert.throws(()=>f.run('mode',{mode:'playRandom',expectedMode:'playCycle'}),/UNSUPPORTED_CONTROL_LAYOUT/);
 f.state['async:listenTogether'].status='together';assert.throws(()=>f.run('mode',{mode:'playRandom',expectedMode:'playOrder'}),/UNSUPPORTED_CONTROL_LAYOUT/);
 f.state['async:listenTogether'].status='alone';f.state.playing.playingMode='playRandom';assert.equal((await f.run('mode',{mode:'playRandom',expectedMode:'playRandom'})).dispatched,false);assert.equal(f.calls.length,0);
});
test('changed native volume contract and mixed or unknown builds fail closed',()=>{
 for(const change of [f=>{f.loader.m[228]=f.loader.m[228].replace('i.AudioPlayer.setVolume(e)','wrong(e)');},f=>{delete f.loader.c[228];},f=>{f.document.scripts.push({src:'orpheus://orpheus/pub/hybrid/app.chunk.5b23b4d.js'});},f=>{f.document.scripts[0].src='orpheus://orpheus/pub/hybrid/app.chunk.unknown.js';}]){
  const f=fixture();change(f);assert.throws(()=>f.run('volume',{percent:30}),/UNSUPPORTED_PLAYLIST_CLIENT/);assert.equal(f.calls.length,0);assert.equal(f.chunks.length,0);
 }
});
test('4f571d4 reads the empty player and rejects a changed native contract',()=>{
 const f=fixture();f.document.scripts[0].src='orpheus://orpheus/pub/hybrid/app.chunk.4f571d4.js';
 f.loader.m[306]=playingFactory;f.loader.c[306]={exports:{}};
 const player=f.run('read');assert.equal(player.trackId,null);assert.equal(player.title,null);assert.equal(player.volumePercent,56);
 assert.equal(f.calls.length,0);assert.equal(f.chunks.length,0);
 f.loader.m[306]=playingFactory.replace('i.AudioPlayer.setVolume(e)','wrong(e)');
 assert.throws(()=>f.run('read'),/UNSUPPORTED_PLAYLIST_CLIENT/);
});

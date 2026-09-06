import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {playerBridge} from '../src/player-bridge.mjs';
import {PlayerController} from '../src/player.mjs';

test('player snapshot projects only music fields and keeps unknown lyrics distinct from empty lyrics',()=>{
 const {document}=parseHTML('<script src="https://local/app.chunk.d4e863d.js"></script><div data-testid="tid_createplaylist_section"></div>');
 Object.defineProperty(document,'scripts',{value:document.querySelectorAll('script')});
 const state={playing:{onlineResourceId:'123',resourceName:'Music',resourceArtists:[{id:9,name:'Artist',privateProfile:'secret'}],resourceCoverUrl:'https://p4.music.126.net/cover.jpg',resourceDuration:242,playingMode:'playOneCycle',playingLyric:[],playingLyricLineNumber:0},host:{token:'secret'}};
 document.querySelector('div').__reactFiber$test={memoizedProps:{value:{store:{getState:()=>state}}}};
 const old=globalThis.document;globalThis.document=document;
 try{const result=playerBridge('read');assert.equal(result.trackId,'123');assert.deepEqual(result.artists,[{id:'9',name:'Artist'}]);assert.deepEqual(result.lyrics,[]);assert.equal(result.durationSeconds,242);assert.doesNotMatch(JSON.stringify(result),/secret|privateProfile|token/);
  state.playing.playingLyric={unexpected:'shape'};assert.equal(playerBridge('read').lyrics,null);
  state.playing.resourceCoverUrl='https://music.126.net.evil.test/a';assert.equal(playerBridge('read').coverUrl,null);
  state.playing.resourceCoverUrl='http://p4.music.126.net/cover.jpg';assert.equal(playerBridge('read').coverUrl,'https://p4.music.126.net/cover.jpg');
 }finally{globalThis.document=old;}
});

test('player joins visible controls only when song identity stays consistent',async()=>{
 let id='1';const controller=new PlayerController({async playerRead(){return {trackId:id,title:'Track',artists:[{name:'Artist'}],lyrics:[]};}}, {async status(){return {title:'Track',artists:'Artist',trackKey:'abc',liked:false,playing:true};}});
 assert.equal((await controller.snapshot()).liked,false);
 const changed=new PlayerController({async playerRead(){return {trackId:id,title:'Track',artists:[]};}}, {async status(){id='2';return {title:'Track',trackKey:'abc',liked:true,playing:true};}});
 await assert.rejects(()=>changed.snapshot(),/TRACK_CHANGED/);
});

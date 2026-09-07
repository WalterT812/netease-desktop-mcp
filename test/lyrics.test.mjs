import test from 'node:test';
import assert from 'node:assert/strict';
import {LyricsController} from '../src/lyrics.mjs';
import {PlayerController} from '../src/player.mjs';

const value=id=>({trackId:id,timedLyrics:[{timeSeconds:5,text:'Line one',translation:'译文一'},{timeSeconds:10,text:'Line two'}],lyricStatus:'available',source:'client_lyric_api'});
test('lyrics cache follows the exact song ID and expires without storing an old song',async()=>{
 let now=0,calls=0;const c=new LyricsController({async lyricsRead(id){calls++;return value(id);}},{now:()=>now});
 await c.read('1');await c.read('1');assert.equal(calls,1);await c.read('2');assert.equal(calls,2);await c.read('1');assert.equal(calls,3);
 now=600001;await c.read('1');assert.equal(calls,4);
});
test('lyric timing handles intro, boundaries, pause positions and backward seeks',()=>{
 const c=new LyricsController({}),v=value('1');
 assert.equal(c.project(v,0).lyricLine,-1);assert.equal(c.project(v,5).lyricLine,0);assert.equal(c.project(v,10).lyricLine,1);
 assert.equal(c.project(v,10).lyricLine,1);assert.equal(c.project(v,6).lyricLine,0);assert.equal(c.project(v,null).lyricLine,null);
 assert.deepEqual(c.project(v,6).lyrics,['Line one','Line two']);assert.equal(c.project(v,6).timedLyrics[0].translation,'译文一');
});
test('failed lyric requests remain unknown, cool down and recover without suppressing track changes',async()=>{
 let now=0,calls=0;const c=new LyricsController({async lyricsRead(id){calls++;if(calls===1)throw Error('network');return value(id);}},{now:()=>now});
 assert.equal((await c.read('1')).lyricStatus,'unavailable');assert.equal((await c.read('1')).timedLyrics,null);assert.equal(calls,1);
 now=15001;assert.equal((await c.read('1')).lyricStatus,'available');
 const changed=new LyricsController({async lyricsRead(){return value('2');}});await assert.rejects(changed.read('1'),/TRACK_CHANGED/);
});
test('player recomputes the current lyric from fresh progress without fetching every poll',async()=>{
 let positionSeconds=6,calls=0;const snapshot=()=>({trackId:'1',title:'Song',artists:[{name:'Artist'}],positionSeconds,lyrics:[]});
 const c=new PlayerController({async playerRead(){return snapshot();},async lyricsRead(id){calls++;return value(id);}},{async status(){return {title:'Song',artists:'Artist',playing:true};}});
 assert.equal((await c.snapshot()).lyricLine,0);positionSeconds=11;assert.equal((await c.snapshot()).lyricLine,1);assert.equal(calls,1);
});
test('a track change while lyrics are fetched cannot display the previous song lyrics',async()=>{
 let id='1';const c=new PlayerController({async playerRead(){return {trackId:id,title:'Song',artists:[],positionSeconds:10};},async lyricsRead(trackId){id='2';return value(trackId);}},{async status(){return {title:'Song',artists:'',playing:true};}});
 await assert.rejects(c.snapshot(),/TRACK_CHANGED/);
});

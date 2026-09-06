import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {playerBridge} from '../src/player-bridge.mjs';
import {PlayerController} from '../src/player.mjs';

test('progress and volume use verified fields; seek is bound to exact song and range',()=>{
 const {document}=parseHTML('<script src="https://local/app.chunk.d4e863d.js"></script><div data-testid="tid_createplaylist_section"></div><input type="range" _nk="os9s91" min="0" max="240" value="42">');
 Object.defineProperty(document,'scripts',{value:document.querySelectorAll('script')});
 const state={playing:{onlineResourceId:'123',resourceTrackId:'123',resourceDuration:240,playingVolume:.55}},calls=[];
 document.querySelector('div').__reactFiber$test={memoizedProps:{value:{store:{getState:()=>state,dispatch:v=>calls.push(v)}}}};
 const old=globalThis.document;globalThis.document=document;
 try{const r=playerBridge('read');assert.equal(r.positionSeconds,42);assert.equal(r.volumePercent,55);
 assert.throws(()=>playerBridge('seek',{trackId:'456',seconds:60}),/TRACK_CHANGED/);
 assert.throws(()=>playerBridge('seek',{trackId:'123',seconds:241}),/INVALID_ARGUMENT/);
 assert.throws(()=>playerBridge('volume',{percent:101}),/INVALID_ARGUMENT/);assert.equal(calls.length,0);
 playerBridge('seek',{trackId:'123',seconds:60});assert.deepEqual(calls[0],{type:'playing/setPlayingPosition',payload:{duration:60}});
 playerBridge('volume',{percent:40});assert.deepEqual(calls[1],{type:'playing/setVolume',payload:{volume:.4}});
 }finally{globalThis.document=old;}
});
test('seek verifies position without retrying a command on changed song',async()=>{
 let state={trackId:'123',positionSeconds:20,durationSeconds:240,volumePercent:55},calls=0;
 const adapter={async playerRead(){return state;},async playerControl(action,args){calls++;state={...state,trackId:'456',positionSeconds:args.seconds};}};
 const p=new PlayerController(adapter,{});await assert.rejects(()=>p.seek('123',50),/TRACK_CHANGED/);assert.equal(calls,1);
});

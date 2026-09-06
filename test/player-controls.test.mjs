import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {playerBridge} from '../src/player-bridge.mjs';
import {PlayerController} from '../src/player.mjs';

test('mode button only activates once when the expected visible mode still matches',()=>{
 const {document}=parseHTML('<script src="https://local/app.chunk.d4e863d.js"></script><div data-testid="tid_createplaylist_section"></div><div class="default-bar-wrapper"><button><span title="单曲循环"></span></button></div>');
 Object.defineProperty(document,'scripts',{value:document.querySelectorAll('script')});
 const state={playing:{playingMode:'playOneCycle'}};document.querySelector('[data-testid]').__reactFiber$test={memoizedProps:{value:{store:{getState:()=>state}}}};
 document.querySelector('span').getClientRects=()=>[{}];let clicks=0;document.querySelector('button').click=()=>{clicks++;};
 const old=globalThis.document;globalThis.document=document;
 try{assert.throws(()=>playerBridge('cycleMode',{expectedMode:'playRandom'}),/UNSUPPORTED_CONTROL_LAYOUT/);assert.throws(()=>playerBridge('cycleMode',{expectedMode:'unknown'}),/INVALID_ARGUMENT/);assert.equal(clicks,0);playerBridge('cycleMode',{expectedMode:'playOneCycle'});assert.equal(clicks,1);}finally{globalThis.document=old;}
});

test('mode switching verifies actual mode and never repeats an unconfirmed click',async()=>{
 let calls=0,mode='playRandom';const adapter={async playerControl(){calls++;},async playerRead(){return {mode};}};const player=new PlayerController(adapter,{});
 assert.deepEqual(await player.cycleMode('playOneCycle'),{verified:true,mode:'playRandom'});assert.equal(calls,1);
 mode='playOneCycle';await assert.rejects(player.cycleMode('playOneCycle'),/MODE_NOT_VERIFIED/);assert.equal(calls,2);
});

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

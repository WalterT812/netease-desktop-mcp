import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { catalogBridge } from '../src/catalog-bridge.mjs';
import { CatalogController } from '../src/catalog.mjs';
import { DesktopAdapter } from '../src/adapter.mjs';

const json = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const state = { host: { uid: 9, isAnonymous: false }, playing: { id: '99', volume: 0.2 }, 'async:hostResource': {
    starPlaylistId: '1', createPlaylist: [{ id: '10', userId: 9, subscribed: false }], favPlaylist: [{ id: '20' }],
  } };
  const playlist = { id: '10', name: 'Target', creator: { userId: 9 }, specialType: 0, privacy: 10, trackCount: 1, trackIds: [{ id: '5' }] };
  const track = id => ({ id, name: `Song ${id}`, artists: [{ name: 'Artist' }], album: { name: 'Album' }, duration: 1000 });
  const calls = [];
  const api = {
    async V(p, o) { calls.push({ method: 'V', p, o }); return { code: 200, result: { songs: [track(p.s === 'First' ? '7' : '8')], songCount: 1 } }; },
    async Rh(p, o) { calls.push({ method: 'Rh', p, o }); return { code: 200, playlist: structuredClone(playlist) }; },
    async Oh(p, o) { calls.push({ method: 'Oh', p, o }); return JSON.parse(p.c).map(p => track(p.id)); },
    async zh(p, o) { calls.push({ method: 'zh', p, o }); playlist.trackIds.push(...JSON.parse(p.trackIds).map(id => ({ id }))); playlist.trackCount = playlist.trackIds.length; return { code: 200 }; },
  };
  const loader = { c: { 14: { exports: api } }, m: {} };
  const chunks = [];
  chunks.push = function (payload) { Array.prototype.push.call(this, payload); const [id, fn] = Object.entries(payload[1])[0]; loader.m[id] = fn; loader.c[id] = {}; fn({}, {}, loader); };
  const store = { getState: () => state, async dispatch(p) { calls.push({ method: 'dispatch', p }); } };
  const document = { scripts: [{ src: 'orpheus://orpheus/pub/hybrid/app.chunk.d4e863d.js' }], querySelector: () => ({ __reactInternalInstance$test: { memoizedProps: { value: { store } } } }) };
  const run = (action, args = {}) => runInNewContext(`(${catalogBridge.toString()})(action,args)`, { document, window: { webpackJsonp: chunks }, action, args, setTimeout: fn => setTimeout(fn, 1) });
  const add = { playlistId: '10', expectedName: 'Target', trackIds: ['5', '7'], protectedIds: [] };
  return { state, playlist, api, calls, loader, chunks, document, run, add, store };
}

function playFixture() {
  const f = fixture();
  f.state.playing = { playingVolume: 0.43, playingMode: 'playRandom', playingState: 2, onlineResourceId: '99', curPlaying: { resourceId: '99' }, resourceName: 'Old' };
  const entry = (id, displayOrder) => ({ resourceId: id, trackId: id, track: { id }, displayOrder, resourceType: 'track' });
  f.state.playingList = { curPlayingList: [entry('99', 0)] };
  f.state['async:listenTogether'] = { status: 'alone' };
  f.playlist.trackIds = [{ id: '7' }, { id: '5' }]; f.playlist.trackCount = 2;
  f.store.dispatch = async p => {
    f.calls.push({ method: 'dispatch', p });
    if (p.type === 'playing/switchPlayingMode') f.state.playing.playingMode = p.payload.playingMode;
    if (p.type === 'playing/play') {
      f.state.playingList.curPlayingList = p.payload.tracks.map((t, i) => entry(String(t.id), i));
      Object.assign(f.state.playing, { onlineResourceId: p.payload.options.playId, curPlaying: { resourceId: p.payload.options.playId }, resourceName: 'First song', playingState: 2 });
    }
  };
  f.play = { playlistId: '10', expectedName: 'Target', expectedVolume: 0.43 };
  return f;
}

test('playlist playback replaces the queue in fresh member order and preserves raw volume', async () => {
  const f = playFixture(), original = f.api.Oh;
  f.api.Oh = async (p, o) => (await original(p, o)).reverse();
  const result = await f.run('play_playlist', f.play);
  assert.equal(result.verified, true); assert.deepEqual(json(result.trackIds), ['7', '5']);
  assert.equal(result.trackId, '7'); assert.equal(result.currentQueueId, '7');
  assert.equal(result.volume, 0.43); assert.equal(result.mode, 'playOrder'); assert.equal(result.playing, true);
  const writes = f.calls.filter(c => c.method === 'dispatch').map(c => c.p);
  assert.deepEqual(writes.map(p => p.type), ['playing/switchPlayingMode', 'playing/play']);
  assert.deepEqual(json(writes[1].payload.options), { clear: true, play: true, playId: '7' });
  assert.equal(writes[1].payload.from.needOpenVinylPage, false);
  assert.equal(writes[1].payload.from.fromInfo.sourceData.id, '10');
  assert.equal(f.calls.some(c => c.method === 'zh'), false);
});

test('queue reads sort display order and reject ambiguous, local or duplicate identities', async () => {
  const f = playFixture();
  f.state.playingList.curPlayingList.push({ resourceId: '98', trackId: '98', track: { id: '98' }, displayOrder: 1, resourceType: 'track' });
  f.state.playingList.curPlayingList.reverse();
  assert.deepEqual(json((await f.run('queue')).trackIds), ['99', '98']);
  assert.equal(f.calls.length, 0);
  for (const change of [t => t.displayOrder = 0, t => t.track.id = '12', t => t.resourceType = 'voice']) {
    const g = playFixture(); change(g.state.playingList.curPlayingList[0]);
    if (g.state.playingList.curPlayingList[0].displayOrder === 0 && g.state.playingList.curPlayingList[0].track.id === '99' && g.state.playingList.curPlayingList[0].resourceType === 'track') g.state.playingList.curPlayingList.push(structuredClone(g.state.playingList.curPlayingList[0]));
    await assert.rejects(g.run('queue'), /INVALID_QUEUE_STATE/);
  }
});

test('playlist preflight rejects empty, oversized, renamed, together and nonstandard modes before writes', async () => {
  for (const change of [
    f => { f.playlist.trackIds = []; f.playlist.trackCount = 0; },
    f => { f.playlist.trackIds = Array.from({length:201}, (_,i) => ({id:String(i+1)})); f.playlist.trackCount = 201; },
    f => f.playlist.name = 'Changed',
    f => f.state['async:listenTogether'].status = 'together',
    f => f.state.playing.playingMode = 'playAi',
    f => f.play.expectedVolume = 0.2,
  ]) {
    const f = playFixture(); change(f);
    await assert.rejects(f.run('play_playlist', f.play), /PLAYLIST_PLAY_UNSUPPORTED|PLAYLIST_CHANGED/);
    assert.equal(f.calls.some(c => c.method === 'dispatch'), false);
  }
});

test('playlist membership order or account changes during preflight prevent playback', async () => {
  for (const change of [f => f.playlist.trackIds.reverse(), f => f.state.host.uid = 11]) {
    const f = playFixture(), original = f.api.Oh;
    f.api.Oh = async (p,o) => { const r=await original(p,o); change(f); return r; };
    await assert.rejects(f.run('play_playlist', f.play), /PLAYLIST_CHANGED/);
    assert.equal(f.calls.some(c => c.method === 'dispatch'), false);
  }
});

test('missing or reordered queue, wrong current ID, paused state or volume change cannot pass playback verification', async () => {
  for (const change of [
    f => f.state.playingList.curPlayingList.pop(),
    f => { const a=f.state.playingList.curPlayingList; a[0].displayOrder=1; a[1].displayOrder=0; },
    f => f.state.playing.onlineResourceId = '99',
    f => f.state.playing.playingState = 1,
    f => f.state.playing.playingVolume = 0.44,
  ]) {
    const f = playFixture(), original = f.store.dispatch;
    f.store.dispatch = async p => { await original(p); if(p.type==='playing/play')change(f); };
    await assert.rejects(f.run('play_playlist', f.play), /PLAYLIST_PLAY_OUTCOME_UNKNOWN/);
    assert.equal(f.calls.filter(c => c.method === 'dispatch' && c.p.type === 'playing/play').length, 1);
  }
});

test('lost play response succeeds only by readback; lost mode response never proceeds to playback', async () => {
  const f = playFixture(), original = f.store.dispatch;
  f.store.dispatch = async p => { await original(p); if(p.type==='playing/play')throw Error('lost'); };
  assert.equal((await f.run('play_playlist', f.play)).responseLost, true);
  assert.equal(f.calls.filter(c => c.method === 'dispatch' && c.p.type === 'playing/play').length, 1);
  const g = playFixture(); g.store.dispatch = async p => { g.calls.push({method:'dispatch',p}); throw Error('lost'); };
  await assert.rejects(g.run('play_playlist', g.play), /PLAYLIST_PLAY_OUTCOME_UNKNOWN/);
  assert.equal(g.calls.some(c => c.p?.type === 'playing/play'), false);
});

test('playlist controller blocks replay after timeout and still exposes bounded read-only queue', async () => {
  const calls=[];
  const c=new CatalogController({async catalogRun(action,args){calls.push({action,args}); if(action==='queue')return {trackIds:['1','2'],trackCount:2,volume:0.43}; throw Error('CDP_TIMEOUT');}});
  await assert.rejects(c.playPlaylist('10','Target'), /CDP_TIMEOUT/);
  await assert.rejects(c.playPlaylist('10','Target'), /PLAYLIST_PLAY_OUTCOME_UNKNOWN/);
  const page=await c.queue(1,1); assert.deepEqual(page.trackIds,['2']); assert.equal(page.complete,false);
  assert.equal(calls.filter(c=>c.action==='play_playlist').length,1);
});

test('lyrics use the fixed current-song API and project timed text without contributor data', async () => {
  const f=fixture();f.state.playing.onlineResourceId='7';
  f.api.xg=async(p,o)=>{f.calls.push({p,o});return {code:200};};
  f.loader.c[373]={exports:{a:()=>({displayType:'default',lyricContributor:{secret:'private'},lyricLines:[{time:1,lyric:'Text'}],tlyricLines:[{time:1,lyric:'译文'}]})}};
  const result=await f.run('lyrics',{trackId:'7'});
  assert.deepEqual(json(result.timedLyrics),[{timeSeconds:1,text:'Text',translation:'译文'}]);assert.equal(result.lyricStatus,'available');
  assert.equal(f.calls[0].p.id,'7');assert.equal(f.calls[0].o.cacheStrategy.enable,false);assert.doesNotMatch(JSON.stringify(result),/private|Contributor/);
  await assert.rejects(f.run('lyrics',{trackId:'8'}),/TRACK_CHANGED/);assert.equal(f.calls.length,1);
});

test('lyrics refuse a changed song or malformed response and preserve pure-music state',async()=>{
 const f=fixture();f.state.playing.onlineResourceId='7';f.api.xg=async()=>({code:200});
 f.loader.c[373]={exports:{a:()=>({displayType:'pure',lyricLines:[],tlyricLines:[]})}};
 assert.equal((await f.run('lyrics',{trackId:'7'})).lyricStatus,'instrumental');
 f.loader.c[373].exports.a=()=>({lyricLines:[{time:NaN,lyric:'Bad'}]});await assert.rejects(f.run('lyrics',{trackId:'7'}),/INVALID_CATALOG_RESPONSE/);
 f.api.xg=async()=>{f.state.playing.onlineResourceId='8';return {code:200};};await assert.rejects(f.run('lyrics',{trackId:'7'}),/TRACK_CHANGED/);
});

test('background search correlates query and response and removes disposable loader entries', async () => {
  const f = fixture();
  const first = await f.run('search', { query: 'First', limit: 10 });
  const second = await f.run('search', { query: 'Second', limit: 10 });
  assert.equal(first.query, 'First'); assert.equal(first.items[0].id, '7');
  assert.equal(second.query, 'Second'); assert.equal(second.items[0].id, '8');
  assert.equal(second.source, 'client_api');
  assert.equal(f.calls.length, 2); assert.equal(f.chunks.length, 0);
  assert.deepEqual(Object.keys(f.loader.m), []); assert.deepEqual(Object.keys(f.loader.c), ['14']);
  assert.ok(f.calls.every(c => c.o.skipLocalRpcCache && c.o.cacheStrategy.enable === false));
});

test('out-of-order search completion cannot substitute another query response', async () => {
  const f = fixture(), first = Promise.withResolvers();
  const original = f.api.V;
  f.api.V = async (p, o) => { if (p.s === 'First') await first.promise; return original(p, o); };
  const a = f.run('search', { query: 'First', limit: 10 });
  const b = await f.run('search', { query: 'Second', limit: 10 }); first.resolve();
  assert.equal(b.items[0].id, '8'); assert.equal((await a).items[0].id, '7');
});

test('empty results require a valid response and search never writes client state', async () => {
  const f = fixture(), before = json(f.state);
  f.api.V = async () => ({ code: 200, result: { songCount: 0 } });
  assert.equal((await f.run('search', { query: 'Empty', limit: 10 })).items.length, 0);
  f.api.V = async () => ({ code: 500, result: {} });
  await assert.rejects(f.run('search', { query: 'Bad', limit: 10 }), /INVALID_CATALOG_RESPONSE/);
  assert.deepEqual(json(f.state), before);
});

test('add dispatches only missing exact IDs once, bypasses caches and verifies members', async () => {
  const f = fixture(), beforeState = json(f.state);
  const result = await f.run('add_tracks', f.add);
  assert.equal(result.verified, true); assert.deepEqual(json(result.addedIds), ['7']);
  assert.deepEqual(json(result.alreadyPresentIds), ['5']); assert.equal(result.trackCount, 2);
  const writes = f.calls.filter(c => c.method === 'zh');
  assert.equal(writes.length, 1);
  assert.deepEqual(json(writes[0].p), { op: 'add', pid: '10', trackIds: '["7"]' });
  assert.equal(f.calls.at(-1).method, 'Rh');
  assert.ok(f.calls.every(c => c.o.skipLocalRpcCache && c.o.cacheStrategy.enable === false));
  assert.deepEqual(json(f.state), beforeState);
});

test('already-present songs do not send an add request', async () => {
  const f = fixture(); f.add.trackIds = ['5'];
  const result = await f.run('add_tracks', f.add);
  assert.equal(result.changed, false); assert.equal(f.calls.some(c => c.method === 'zh'), false);
});

test('ownership, collections, system and configured protection refuse writes', async () => {
  for (const change of [
    f => f.playlist.creator.userId = 8,
    f => f.state['async:hostResource'].favPlaylist.push({ id: '10' }),
    f => f.playlist.specialType = 5,
    f => f.add.protectedIds = ['10'],
    f => f.state['async:hostResource'].createPlaylist[0].subscribed = true,
    f => f.add.expectedName = 'Old name',
  ]) {
    const f = fixture(); change(f);
    await assert.rejects(f.run('add_tracks', f.add), /NOT_OWNED_PLAYLIST|PROTECTED_PLAYLIST|PLAYLIST_CHANGED/);
    assert.equal(f.calls.some(c => c.method === 'zh'), false);
  }
});

test('incomplete members, duplicate requested IDs and substituted catalog IDs refuse writes', async () => {
  for (const change of [
    f => f.playlist.trackCount = 9,
    f => f.add.trackIds = ['7', '7'],
    f => f.api.Oh = async () => [{ id: '999', name: 'Wrong', artists: [], album: {} }],
  ]) {
    const f = fixture(); change(f);
    await assert.rejects(f.run('add_tracks', f.add), /INCOMPLETE_PLAYLIST_MEMBERS|INVALID_ARGUMENT|TRACK_ID_MISMATCH/);
    assert.equal(f.calls.some(c => c.method === 'zh'), false);
  }
});

test('account or membership changes during preflight prevent a mutation', async () => {
  for (const change of [f => f.state.host.uid = 8, f => { f.playlist.trackIds = []; f.playlist.trackCount = 0; }]) {
    const f = fixture(), original = f.api.Oh;
    f.api.Oh = async (p, o) => { const value = await original(p, o); change(f); return value; };
    await assert.rejects(f.run('add_tracks', f.add), /PLAYLIST_CHANGED/);
    assert.equal(f.calls.some(c => c.method === 'zh'), false);
  }
});

test('lost write response can only succeed through exact readback, without resend', async () => {
  const f = fixture(), original = f.api.zh;
  f.api.zh = async (p, o) => { await original(p, o); throw new Error('network details must stay private'); };
  const result = await f.run('add_tracks', f.add);
  assert.equal(result.verified, true); assert.equal(result.responseLost, true);
  assert.equal(f.calls.filter(c => c.method === 'zh').length, 1);
});

test('failed write, unreadable readback or unexpected extra members never claim success', async () => {
  for (const kind of ['unchanged', 'read-error', 'extra']) {
    const f = fixture(), original = f.api.zh;
    f.api.zh = async (p, o) => {
      if (kind === 'unchanged') { f.calls.push({ method: 'zh' }); throw Error('lost'); }
      await original(p, o);
      if (kind === 'read-error') f.api.Rh = async () => { throw Error('private server message'); };
      else { f.playlist.trackIds.push({ id: '99' }); f.playlist.trackCount++; }
      return { code: 200 };
    };
    await assert.rejects(f.run('add_tracks', f.add), /ADD_OUTCOME_UNKNOWN/);
    assert.equal(f.calls.filter(c => c.method === 'zh').length, 1);
  }
});

test('uncertain recovery only reads; it cannot dispatch another add', async () => {
  const f = fixture();
  await assert.rejects(f.run('add_tracks', { ...f.add, readOnlyRecovery: true }), /ADD_OUTCOME_UNKNOWN/);
  assert.equal(f.calls.some(c => c.method === 'zh'), false);
  f.add.trackIds = ['5'];
  assert.equal((await f.run('add_tracks', { ...f.add, readOnlyRecovery: true })).verified, true);
});

test('single-song playback supplies the source metadata required by native playback', async () => {
  const f = fixture(), item = { id: '7', title: 'Song 7', artists: 'Artist', album: 'Album' };
  f.store.dispatch = async action => {
    const { originalScene, originalResourceType, computeSourceResourceType, sourceData } = action.payload.from.fromInfo;
    assert.equal(originalScene, 'search');
    assert.equal(originalResourceType, 'track');
    assert.equal(computeSourceResourceType, 'track');
    assert.equal(sourceData.id, item.id);
    assert.equal(action.payload.from.needOpenVinylPage, false);
    assert.equal(action.payload.options.clear, false);
    f.calls.push({ method: 'dispatch', action });
  };
  assert.equal((await f.run('play_result', { item })).dispatched, true);
  assert.equal(f.calls.filter(c => c.method === 'dispatch').length, 1);
});

test('background play validates catalog metadata then dispatches one exact track', async () => {
  const f = fixture(), item = { id: '7', title: 'Song 7', artists: 'Artist', album: 'Album' };
  await assert.rejects(f.run('play_result', { item: { ...item, album: 'Different recording' } }), /STALE_SEARCH/);
  assert.equal(f.calls.some(c => c.method === 'dispatch'), false);
  await f.run('play_result', { item });
  const call = f.calls.find(c => c.method === 'dispatch');
  assert.equal(call.p.type, 'playing/play'); assert.equal(call.p.payload.tracks[0].id, '7');
  assert.equal(call.p.payload.options.clear, false);
});

test('unknown builds and actions fail closed without exposing arbitrary APIs', async () => {
  const f = fixture(); f.document.scripts[0].src = 'unknown.js';
  await assert.rejects(f.run('search', { query: 'First', limit: 10 }), /UNSUPPORTED_CATALOG_CLIENT/);
  await assert.rejects(f.run('request', { url: '/anything' }), /UNKNOWN_ACTION/);
  assert.equal(f.calls.length, 0);
});

test('controller opt-in, protected IDs and timeout recovery prevent blind retries', async () => {
  const calls = [], adapter = { async catalogRun(action, args) { calls.push({ action, args }); throw Error('CDP_TIMEOUT'); } };
  await assert.rejects(new CatalogController(adapter).add('10', 'Target', ['7']), /PLAYLIST_ADD_DISABLED/);
  const c = new CatalogController(adapter, { addEnabled: true, protectedIds: ['1'] });
  await assert.rejects(c.add('1', 'Liked', ['7']), /PROTECTED_PLAYLIST/);
  await assert.rejects(c.add('10', 'Target', ['7']), /CDP_TIMEOUT/);
  await assert.rejects(c.add('10', 'Target', ['8']), /ADD_OUTCOME_UNKNOWN/);
  await assert.rejects(c.add('10', 'Target', ['7']), /CDP_TIMEOUT/);
  assert.equal(calls.length, 2); assert.equal(calls[1].args.readOnlyRecovery, true);
});

test('adapter search routes to background API without Input commands or DOM search', async () => {
  const a = new DesktopAdapter({ executable: 'fixture.exe' }); a.connect = async () => {};
  const calls = []; a.cdp = { async evaluate(fn, args) { calls.push({ fn, args }); return {}; } };
  await a.run('search', { query: 'First', limit: 10 });
  assert.equal(calls.length, 1); assert.equal(calls[0].fn, catalogBridge);
});

async function renameFixture() {
  const f = playFixture();
  f.loader.c[13] = { exports: { a(config) {
    assert.deepEqual(json(config), { url: '/api/batch', cacheStrategy: { enable: false } });
    return async (p, o) => { f.calls.push({ method: 'rename', p, o }); f.playlist.name = p['/api/playlist/update/name'].name; return { code: 200, '/api/playlist/update/name': { code: 200 } }; };
  } } };
  f.rename = { playlistId: '10', expectedName: 'Target', newName: 'English pop', protectedIds: [], baseline: await f.run('playlist_tracks', { playlistId: '10' }) };
  return f;
}

test('rename sends only the name once, verifies uncached exact ordered members and leaves playback alone', async () => {
  const f = await renameFixture(), before = structuredClone(f.state.playing);
  const result = await f.run('rename_playlist', f.rename);
  assert.equal(result.verified, true); assert.equal(result.playlistName, 'English pop'); assert.equal(result.playbackPreserved, true);
  const writes = f.calls.filter(c => c.method === 'rename'); assert.equal(writes.length, 1);
  assert.deepEqual(json(writes[0].p), { '/api/playlist/update/name': { id: '10', name: 'English pop' } });
  for (const c of f.calls.filter(c => ['Rh', 'rename'].includes(c.method))) assert.deepEqual(json(c.o), { skipLocalRpcCache: true, cacheStrategy: { enable: false } });
  assert.deepEqual(f.state.playing, before); assert.equal(f.calls.some(c => c.method === 'dispatch'), false);
});

test('rename refuses protected, collected, foreign, renamed, reordered and malformed targets before writes', async () => {
  for (const change of [f=>f.rename.protectedIds.push('10'), f=>f.playlist.specialType=5, f=>f.state['async:hostResource'].favPlaylist.push({id:'10'}), f=>f.playlist.creator.userId=8, f=>f.playlist.name='Other', f=>f.playlist.trackIds.reverse(), f=>f.rename.newName=' ', f=>f.rename.newName='bad\nname']) {
    const f=await renameFixture();change(f);await assert.rejects(f.run('rename_playlist',f.rename),/PROTECTED|NOT_OWNED|PLAYLIST_CHANGED|INVALID_ARGUMENT/);assert.equal(f.calls.some(c=>c.method==='rename'),false);
  }
});

test('rename fails closed on membership, privacy, account, name or playback changes after writing', async () => {
  for(const change of [f=>f.playlist.trackIds.reverse(),f=>f.playlist.privacy=0,f=>f.state.host.uid=8,f=>f.playlist.name='Rejected',f=>f.state.playing.playingVolume=.5]) {
    const f=await renameFixture(),factory=f.loader.c[13].exports.a;
    f.loader.c[13].exports.a=config=>{const request=factory(config);return async(p,o)=>{const r=await request(p,o);change(f);return r;};};
    await assert.rejects(f.run('rename_playlist',f.rename),/RENAME_OUTCOME_UNKNOWN/);assert.equal(f.calls.filter(c=>c.method==='rename').length,1);
  }
});

test('rename recovers a lost response using reads and never resends during recovery', async () => {
  const f=await renameFixture(),factory=f.loader.c[13].exports.a;
  f.loader.c[13].exports.a=config=>{const request=factory(config);return async(p,o)=>{await request(p,o);throw Error('lost');};};
  assert.equal((await f.run('rename_playlist',f.rename)).responseLost,true);
  assert.equal((await f.run('rename_playlist',{...f.rename,readOnlyRecovery:true})).verified,true);
  f.playlist.trackIds.reverse();await assert.rejects(f.run('rename_playlist',{...f.rename,readOnlyRecovery:true}),/RENAME_OUTCOME_UNKNOWN/);
  assert.equal(f.calls.filter(c=>c.method==='rename').length,1);
});

test('rename controller gates capability and pins uncertain recovery to the original members and arguments', async () => {
  const calls=[],baseline={id:'10',title:'Target',trackIds:['1']};let fail=true;
  const adapter={async catalogRun(action,args){calls.push({action,args});if(action==='playlist_tracks')return baseline;if(fail)throw Error('RENAME_OUTCOME_UNKNOWN');return {verified:true};}};
  await assert.rejects(new CatalogController(adapter).rename('10','Target','New'),/DISABLED/);
  await assert.rejects(new CatalogController(adapter,{renameEnabled:true,protectedIds:['10']}).rename('10','Target','New'),/PROTECTED/);
  assert.equal(calls.length,0);const c=new CatalogController(adapter,{renameEnabled:true});
  await assert.rejects(c.rename('10','Target','New'),/UNKNOWN/);
  await assert.rejects(c.rename('10','Target','Different'),/UNKNOWN/);assert.equal(calls.length,2);
  fail=false;await c.rename('10','Target','New');assert.equal(calls.length,3);assert.equal(calls[2].args.readOnlyRecovery,true);assert.deepEqual(calls[2].args.baseline,baseline);
});

test('3.1.40 resolves lyrics only from its verified formatter, not old module 373', async () => {
 const f=fixture();f.document.scripts[0].src='orpheus://orpheus/pub/hybrid/app.chunk.5b23b4d.js';f.state.playing.onlineResourceId='7';f.api.xg=async()=>({code:200});
 f.loader.c[373]={exports:{a:{subscribe(){throw Error('unrelated websocket module');}}}};
 f.loader.c[376]={exports:{a:()=>({lyricLines:[{time:2,lyric:'Modern lyric'}],tlyricLines:[{time:2,lyric:'译文'}]})}};
 assert.deepEqual(json((await f.run('lyrics',{trackId:'7'})).timedLyrics),[{timeSeconds:2,text:'Modern lyric',translation:'译文'}]);
 assert.equal((await f.run('playlist_tracks',{playlistId:'10'})).trackCount,1);
 delete f.loader.c[376];await assert.rejects(f.run('lyrics',{trackId:'7'}),/UNSUPPORTED_CATALOG_CLIENT/);
});

test('catalog rejects mixed and unknown app builds before any API request', async () => {
 for(const script of ['5b23b4d','abcdef0']){const f=fixture();f.document.scripts.push({src:`orpheus://orpheus/pub/hybrid/app.chunk.${script}.js`});await assert.rejects(f.run('search',{query:'First',limit:2}),/UNSUPPORTED_CATALOG_CLIENT/);assert.equal(f.calls.length,0);}
});

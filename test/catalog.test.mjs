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
  const run = (action, args = {}) => runInNewContext(`(${catalogBridge.toString()})(action,args)`, { document, window: { webpackJsonp: chunks }, action, args });
  const add = { playlistId: '10', expectedName: 'Target', trackIds: ['5', '7'], protectedIds: [] };
  return { state, playlist, api, calls, loader, chunks, document, run, add };
}

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

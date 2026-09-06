import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { playlistBridge } from '../src/playlist-bridge.mjs';

function fixture() {
  const item = (id, name, specialType = null) => ({ id, name, specialType, trackCount: 2, updateTime: 1, userId: 9, subscribed: false });
  const state = { host: { uid: 9, isAnonymous: false }, 'async:hostResource': {
    starPlaylistId: 1, createPlaylist: [item(1, 'Liked', 5), item(10, 'Keep'), item(11, 'Remove', 300)],
    favPlaylist: [{ ...item(20, 'Collected'), userId: 8, subscribed: true }],
  } };
  const calls = [];
  const store = { getState: () => state, async dispatch(action) { calls.push(action); if (action.type === 'async:hostResource/createPlaylist') return '12'; } };
  const document = { scripts: [{ src: 'orpheus://orpheus/pub/hybrid/app.chunk.d4e863d.js' }], querySelector: () => ({ __reactInternalInstance$fixture: { memoizedProps: { value: { store } } } }) };
  const run = (action, args = {}) => runInNewContext(`(${playlistBridge.toString()})(action,args)`, { document, action, args });
  const expected = { id: '11', title: 'Remove', trackCount: 2, updateTime: 1, accountId: '9' };
  return { state, calls, document, run, expected };
}

test('bridge reads full store and refreshes without UI input; special type 300 stays owned', async () => {
  const f = fixture(), result = await f.run('refresh');
  assert.equal(result.created.length, 2);
  assert.equal(result.created[1].owned, true);
  assert.equal(result.collected.length, 1);
  assert.equal(result.system.id, '1');
  assert.equal(f.calls[0].type, 'async:hostResource/fetchHostPlaylist');
});

test('bridge refuses unknown builds, logged-out accounts and malformed/duplicate library IDs', async () => {
  for (const change of [
    f => f.document.scripts[0].src = 'orpheus://orpheus/pub/hybrid/app.chunk.unknown.js',
    f => f.state.host.isAnonymous = true,
    f => f.state['async:hostResource'].favPlaylist[0].id = 11,
  ]) {
    const f = fixture(); change(f);
    await assert.rejects(f.run('delete', { expected: f.expected, protectedIds: [] }), /UNSUPPORTED_PLAYLIST_CLIENT|PLAYLIST_LOGIN_REQUIRED|INVALID_PLAYLIST_STATE/);
    assert.equal(f.calls.length, 0);
  }
});

test('page rechecks protected, collected and system IDs, changed ownership and preview fields', async () => {
  for (const change of [
    (f, a) => a.protectedIds.push('11'),
    (f, a) => a.expected.id = '20',
    (f, a) => a.expected.id = '1',
    f => f.state['async:hostResource'].createPlaylist[2].userId = 8,
    f => f.state['async:hostResource'].createPlaylist[2].subscribed = true,
    (f, a) => a.expected.accountId = '8',
    (f, a) => a.expected.trackCount = 3,
    (f, a) => a.expected.title = 'Old name',
    (f, a) => a.expected.updateTime = 0,
  ]) {
    const f = fixture(), args = { expected: f.expected, protectedIds: [] }; change(f, args);
    await assert.rejects(f.run('delete', args), /PROTECTED_PLAYLIST|NOT_OWNED_PLAYLIST|PLAYLIST_CHANGED/);
    assert.equal(f.calls.length, 0);
  }
});

test('page dispatches exactly one fixed own-playlist deletion with its string ID', async () => {
  const f = fixture();
  await f.run('delete', { expected: f.expected, protectedIds: ['10'], playlistType: 'fav' });
  assert.equal(JSON.stringify(f.calls), JSON.stringify([{ type: 'async:hostResource/deletePlaylist', payload: { id: '11', playlistType: 'user' } }]));
});

test('page creates only the requested name and privacy for the expected account', async () => {
  const f = fixture();
  const result = await f.run('create', { name: 'New', isPrivate: true, accountId: '9' });
  assert.equal(result.id, '12');
  assert.equal(JSON.stringify(f.calls), JSON.stringify([{ type: 'async:hostResource/createPlaylist', payload: { name: 'New', isPrivate: true, noToast: true } }]));
});

test('page refuses duplicate names, account changes and invalid create arguments', async () => {
  for (const args of [
    { name: 'Keep', isPrivate: true, accountId: '9' },
    { name: 'New', isPrivate: true, accountId: '8' },
    { name: '', isPrivate: true, accountId: '9' },
    { name: 'New', accountId: '9' },
  ]) {
    const f = fixture();
    await assert.rejects(f.run('create', args), /PLAYLIST_NAME_EXISTS|PLAYLIST_CHANGED|INVALID_ARGUMENT/);
    assert.equal(f.calls.length, 0);
  }
});

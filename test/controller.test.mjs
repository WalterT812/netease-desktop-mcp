import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicController } from '../src/controller.mjs';

function setup() {
  const state = { trackLabel: 'Song A — Artist', playing: true, liked: false };
  const calls = [];
  const adapter = {
    async run(action, args) {
      calls.push({ action, args });
      if (action === 'status') return { ...state };
      if (action === 'like') state.liked = args.liked;
      if (action === 'playback') state.playing = args.playing;
      if (action === 'search') return { query: args.query, items: [{ index: '1', title: 'Song A', artists: 'Artist', album: 'Album' }], partial: true };
      return {};
    },
    disconnect() {},
  };
  return { state, calls, controller: new MusicController(adapter, { timeoutMs: 30, intervalMs: 1 }) };
}
test('changed song prevents like mutation', async () => {
  const { controller, state, calls } = setup();
  const before = await controller.status();
  state.trackLabel = 'Song B — Artist';
  await assert.rejects(controller.setLiked(true, before.trackKey), /TRACK_CHANGED/);
  assert.equal(calls.some(c => c.action === 'like'), false);
});
test('unknown heart state prevents mutation', async () => {
  const { controller, state, calls } = setup();
  state.liked = null;
  const before = await controller.status();
  await assert.rejects(controller.setLiked(true, before.trackKey), /UNKNOWN_LIKE_STATE/);
  assert.equal(calls.some(c => c.action === 'like'), false);
});
test('like is verified and idempotent', async () => {
  const { controller, calls } = setup();
  const before = await controller.status();
  assert.equal((await controller.setLiked(true, before.trackKey)).verified, true);
  await controller.setLiked(true, before.trackKey);
  assert.equal(calls.filter(c => c.action === 'like').length, 1);
});
test('a click without a state transition is not reported as success', async () => {
  const { controller, calls } = setup();
  await assert.rejects(controller.skip('next'), /NOT_VERIFIED/);
  assert.equal(calls.filter(c => c.action === 'skip').length, 1);
});
test('stale result tokens are rejected', async () => {
  const { controller } = setup();
  const first = await controller.search('first');
  await controller.search('second');
  await assert.rejects(controller.playResult(first.searchToken, '1'), /STALE_SEARCH/);
});
test('explicit pause is verified', async () => {
  const { controller } = setup();
  const result = await controller.setPlayback('pause');
  assert.equal(result.state.playing, false);
  assert.equal(result.verified, true);
});
test('a live version cannot satisfy an original-song selection', async () => {
  const { controller, state } = setup();
  const result = await controller.search('Song A');
  state.trackLabel = 'Song A (Live) — Artist';
  await assert.rejects(controller.playResult(result.searchToken, '1'), /NOT_VERIFIED/);
});
test('a timed-out dispatch consumes the search token before any retry', async () => {
  const { controller, calls } = setup();
  const original = controller.adapter.run;
  controller.adapter.run = async (action, args) => {
    const result = await original(action, args);
    if (action === 'play_result') throw new Error('CDP_TIMEOUT');
    return result;
  };
  const found = await controller.search('Song A');
  await assert.rejects(controller.playResult(found.searchToken, '1'), /CDP_TIMEOUT/);
  await assert.rejects(controller.playResult(found.searchToken, '1'), /STALE_SEARCH/);
  assert.equal(calls.filter(c => c.action === 'play_result').length, 1);
});
test('exact title and artist label is accepted for selection playback', async () => {
  const { controller } = setup();
  const found = await controller.search('Song A');
  assert.equal((await controller.playResult(found.searchToken, '1')).verified, true);
});

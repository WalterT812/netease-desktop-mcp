import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { inspectDom } from '../src/dom.mjs';

function fixture({ liked = null, duplicate = false } = {}) {
  const { window } = parseHTML(`<html><body><div class="SearchWrapper_x"><input></div>
    <div class="songPlayInfo_x"><span class="title">Example Song — Example Artist</span></div>
    <div><button id="like" ${liked === null ? '' : `aria-pressed="${liked}"`} title="喜欢"></button>
      <button title="上一首"></button><button id="btn_pc_minibar_play" class="play-pause-btn" title="暂停"></button><button title="下一首"></button></div>
    ${duplicate ? '<button id="btn_pc_minibar_play"></button>' : ''}</body></html>`);
  globalThis.document = window.document;
  globalThis.getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
  window.HTMLElement.prototype.getClientRects = () => [1];
  return window;
}

test('status reads explicit player state without clicking', () => {
  fixture({ liked: true });
  const state = inspectDom('status');
  assert.equal(state.playing, true);
  assert.equal(state.liked, true);
  assert.equal(state.trackLabel, 'Example Song — Example Artist');
});
test('unknown heart state remains unknown despite a generic like title', () => {
  fixture();
  assert.equal(inspectDom('status').liked, null);
});
test('ambiguous player controls fail closed', () => {
  fixture({ duplicate: true });
  assert.throws(() => inspectDom('status'), /AMBIGUOUS/);
});
test('like refuses a different current song before clicking', () => {
  fixture({ liked: false });
  let clicked = false;
  document.getElementById('like').click = () => { clicked = true; };
  assert.throws(() => inspectDom('like', { trackLabel: 'Different Song', liked: true }), /TRACK_CHANGED/);
  assert.equal(clicked, false);
});
test('setting an already liked song does not toggle it off', () => {
  fixture({ liked: true });
  let clicked = false;
  document.getElementById('like').click = () => { clicked = true; };
  inspectDom('like', { trackLabel: 'Example Song — Example Artist', liked: true });
  assert.equal(clicked, false);
});
test('unrecognized DOM action cannot execute arbitrary code', () => {
  fixture();
  assert.throws(() => inspectDom('eval', { expression: '1+1' }), /UNKNOWN_ACTION/);
});
test('a replaced search row is refused before a double click', () => {
  fixture();
  document.body.insertAdjacentHTML('beforeend', `<div id="page_pc_search_result"><span class="keyword">Example</span>
    <div data-log="cell_pc_songlist_song"><span class="td-num">1</span><span class="title">Replacement Song</span><span class="artists" title="Artist"></span><span class="td-album">Album</span></div></div>`);
  assert.throws(() => inspectDom('play_result', { query: 'Example', item: { index: '1', title: 'Original Song', artists: 'Artist', album: 'Album' } }), /STALE_SEARCH/);
});
test('search results stay partial and exclude rows without an identity', () => {
  fixture();
  document.body.insertAdjacentHTML('beforeend', `<div id="page_pc_search_result"><span class="keyword">Example</span>
    <div data-log="cell_pc_songlist_song"><span class="td-num">1</span><span class="title">Song</span><span class="artists" title="Artist"></span><span class="td-album">Album</span></div>
    <div data-log="cell_pc_songlist_song"><span class="title">Incomplete</span></div></div>`);
  const result = inspectDom('search_results', { query: 'Example' });
  assert.equal(result.partial, true);
  assert.deepEqual(result.items, [{ index: '1', title: 'Song', artists: 'Artist', album: 'Album' }]);
});

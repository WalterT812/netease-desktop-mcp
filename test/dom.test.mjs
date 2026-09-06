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

function modernFixture() {
  fixture();
  document.body.innerHTML = `<div class="SearchWrapper_x"><input></div><div class="default-bar-wrapper">
    <div class="songPlayInfo_x"><span data-testid="tid_minibar_title"><span class="title">Example Song</span><span class="author">Example Artist</span></span></div>
    <button id="modern-heart" data-log='{"oid":"btn_pc_like","params":{"type":"1"}}'><span aria-label="like_number"></span></button>
    <div class="middle"><div class="btns"><button><span aria-label="shuffle"></span></button>
      <button data-log='{"oid":"btn_pc_previous","params":{}}'><span aria-label="pre"></span></button>
      <button id="btn_pc_minibar_play" data-log='{"oid":"btn_pc_minibar_play","params":{"type":"play"}}'><span aria-label="play"></span></button>
      <button data-log='{"oid":"btn_pc_next","params":{}}'><span aria-label="next"></span></button>
      <button><span aria-label="playlist"></span></button></div></div></div>`;
}
test('modern five-button player reads separate artist and relocated heart', () => {
  modernFixture();
  const status = inspectDom('status');
  assert.equal(status.trackLabel, 'Example Song — Example Artist');
  assert.equal(status.playing, false);
  assert.equal(status.liked, false);
});
test('modern next uses its exact event identity, not a button offset', () => {
  modernFixture();
  const next = [...document.querySelectorAll('button')].find(e => e.getAttribute('data-log')?.includes('btn_pc_next'));
  let clicked = false;
  next.click = () => { clicked = true; };
  inspectDom('skip', { direction: 'next' });
  assert.equal(clicked, true);
});
test('heart analytics on an unrelated button cannot supply like state', () => {
  modernFixture();
  document.getElementById('modern-heart').setAttribute('data-log', '{"oid":"unrelated","params":{"type":"1"}}');
  assert.equal(inspectDom('status').liked, null);
});

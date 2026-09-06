// Fixed page-side operations. No cookie, storage, account or arbitrary-script API.
// UI markers are informed by Ocrosoft/NetEaseMusic-MCP; see THIRD_PARTY_NOTICES.
export function inspectDom(action, args = {}) {
  const visible = e => e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none';
  const all = (selector, root = document) => [...root.querySelectorAll(selector)].filter(visible);
  const one = (selector, root = document) => {
    const found = all(selector, root);
    if (found.length !== 1) throw new Error(found.length ? 'AMBIGUOUS_CONTROL' : 'CONTROL_NOT_FOUND');
    return found[0];
  };
  const text = e => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const player = () => one('[id="btn_pc_minibar_play"]');
  const analytics = element => {
    try { return JSON.parse(element?.getAttribute('data-log') || '{}'); } catch { return {}; }
  };
  const eventButton = (oid, root) => {
    const found = all('button[data-log]', root).filter(e => analytics(e).oid === oid);
    if (found.length > 1) throw new Error('AMBIGUOUS_CONTROL');
    return found[0] ?? null;
  };
  const controls = () => {
    const play = player();
    const bar = play.closest('.default-bar-wrapper, .vinyl-page-bar-wrapper');
    if (bar) return [eventButton('btn_pc_like', bar), eventButton('btn_pc_previous', bar), play, eventButton('btn_pc_next', bar)];
    const buttons = [...play.parentElement.querySelectorAll('button')].filter(visible);
    // Legacy fallback; modern layouts use exact event identities within the active bar.
    if (buttons.length !== 4 || buttons[2] !== play) throw new Error('UNSUPPORTED_CONTROL_LAYOUT');
    return buttons;
  };
  const song = () => {
    const info = one('[class*="songPlayInfo_"]');
    const title = text(one('.title', info));
    const artists = text(info.querySelector('.author'));
    return { title, artists: artists || null, trackLabel: artists ? `${title} — ${artists}` : title };
  };
  const label = () => song().trackLabel;
  const liked = () => {
    const button = controls()[0];
    if (!button) return null;
    const pressed = button.getAttribute('aria-pressed');
    if (pressed === 'true') return true;
    if (pressed === 'false') return false;
    const log = analytics(button);
    if (log.oid === 'btn_pc_like' && button.querySelector('[aria-label="like_number"]')) {
      // The documented analytics field describes the available action: 1=like, 0=unlike.
      if (log.params?.type === '1') return false;
      if (log.params?.type === '0') return true;
    }
    // Generic "喜欢" tooltips and unknown analytics fields are not state evidence.
    for (const attr of ['title', 'aria-label']) {
      const value = button.getAttribute(attr);
      if (['取消喜欢', '取消红心', 'Unlike'].includes(value)) return true;
      if (['添加到我喜欢的音乐', 'Add to liked songs'].includes(value)) return false;
    }
    return null;
  };
  const playing = () => {
    const button = player();
    const log = analytics(button);
    if (log.oid === 'btn_pc_minibar_play') {
      if (log.params?.type === 'play' && button.querySelector('[aria-label="play"]')) return false;
      if (log.params?.type === 'pause' && button.querySelector('[aria-label="pause"]')) return true;
    }
    if (button.classList.contains('play-pause-btn')) return true;
    const labels = [button.getAttribute('title'), button.getAttribute('aria-label')];
    if (labels.some(v => ['暂停', 'Pause'].includes(v))) return true;
    if (labels.some(v => ['播放', 'Play', '继续播放'].includes(v))) return false;
    return null;
  };
  const getStatus = () => ({ ...song(), playing: playing(), liked: liked() });
  const results = () => {
    const root = one('[id="page_pc_search_result"]');
    const query = text(root.querySelector('.keyword'));
    const rows = all('[data-log*="cell_pc_songlist_song"]', root);
    const items = rows.map(row => ({
      index: text(row.querySelector('.td-num')),
      title: text(row.querySelector('.title')),
      artists: row.querySelector('.artists')?.getAttribute('title') || text(row.querySelector('.artists')),
      album: text(row.querySelector('.td-album')),
    })).filter(row => row.index && row.title);
    return { query, items, partial: true };
  };
  switch (action) {
    case 'probe':
      return { recognized: all('[id="btn_pc_minibar_play"]').length === 1 && all('[class*="SearchWrapper_"] input').length === 1 };
    case 'status': return getStatus();
    case 'playback': {
      if (typeof args.playing !== 'boolean') throw new Error('INVALID_ARGUMENT');
      const current = playing();
      if (current === null) throw new Error('UNKNOWN_PLAYBACK_STATE');
      if (current !== args.playing) player().click();
      return { dispatched: current !== args.playing };
    }
    case 'like': {
      if (typeof args.liked !== 'boolean') throw new Error('INVALID_ARGUMENT');
      if (label() !== args.trackLabel) throw new Error('TRACK_CHANGED');
      const current = liked();
      if (current === null) throw new Error('UNKNOWN_LIKE_STATE');
      if (current !== args.liked) controls()[0].click();
      return { dispatched: current !== args.liked };
    }
    case 'skip': {
      if (!['next', 'previous'].includes(args.direction)) throw new Error('INVALID_ARGUMENT');
      const button = controls()[args.direction === 'next' ? 3 : 1];
      if (!button) throw new Error('CONTROL_NOT_FOUND');
      button.click();
      return { dispatched: true };
    }
    case 'focus_search': {
      const input = one('[class*="SearchWrapper_"] input');
      input.focus();
      input.select();
      return { focused: document.activeElement === input };
    }
    case 'search_tab': {
      const root = one('[id="page_pc_search_result"]');
      if (text(root.querySelector('.keyword')) !== args.query) throw new Error('SEARCH_PENDING');
      one('[id="cmdTab1"]', root).click();
      return { selected: true };
    }
    case 'search_results': {
      const result = results();
      if (result.query !== args.query) throw new Error('SEARCH_PENDING');
      // Empty results require an explicit empty-state message, otherwise keep waiting.
      if (!result.items.length && !/没有找到|暂无|无搜索结果|No results/i.test(text(one('[id="page_pc_search_result"]')))) throw new Error('SEARCH_PENDING');
      return result;
    }
    case 'play_result': {
      const result = results();
      if (result.query !== args.query) throw new Error('STALE_SEARCH');
      const matched = result.items.filter(i => i.index === args.item.index);
      if (matched.length !== 1 || JSON.stringify(matched[0]) !== JSON.stringify(args.item)) throw new Error('STALE_SEARCH');
      const root = one('[id="page_pc_search_result"]');
      const rows = all('[data-log*="cell_pc_songlist_song"]', root).filter(row => text(row.querySelector('.td-num')) === args.item.index);
      if (rows.length !== 1) throw new Error('AMBIGUOUS_RESULT');
      rows[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
      return { dispatched: true };
    }
    default: throw new Error('UNKNOWN_ACTION');
  }
}

// Fixed operations through the tested client's cached API module. No credentials,
// arbitrary endpoint parameters, DOM navigation, focus, or native input are exposed.
export async function catalogBridge(action, args = {}) {
  const fail = code => { throw new Error(code); };
  const validId = id => typeof id === 'string' && /^[1-9]\d{0,19}$/.test(id);
  if (!['search', 'playlist_tracks', 'add_tracks', 'play_result', 'queue', 'play_playlist', 'lyrics', 'rename_playlist'].includes(action)) fail('UNKNOWN_ACTION');
  const builds = [...new Set(Array.from(document.scripts).map(s => /\/app\.chunk\.([^/.?]+)\.js(?:$|\?)/.exec(s.src)?.[1]).filter(Boolean))];
  const profiles = {
    d4e863d: { api: 14, formatter: 373 },
    '5b23b4d': { api: 14, formatter: 376 },
    a526397: { api: 14, formatter: 376, playing: 228, methods: { search: 'V', tracks: 'Rh', song: 'Oh', add: 'zh', lyrics: 'xg' }, contracts: [
      ['V', 'Pn', '/api/cloudsearch/pc'], ['Rh', 'le', '/api/v6/playlist/detail'],
      ['Oh', 'qi', '/api/v3/song/detail'], ['zh', 'Mn', '/api/v1/playlist/manipulate/tracks'],
      ['xg', 'So', '/api/song/lyric/v1'],
    ] },
    '4f571d4': { api: 15, formatter: 368, playing: 306, renameModule: 12, methods: { search: 'V', tracks: 'gi', song: 'di', add: 'Oh', lyrics: 'zg' }, contracts: [
      ['V', 'Mn', '/api/cloudsearch/pc'], ['gi', 'ce', '/api/v6/playlist/detail'],
      ['di', 'Wi', '/api/v3/song/detail'], ['Oh', 'In', '/api/v1/playlist/manipulate/tracks'],
      ['zg', 'To', '/api/song/lyric/v1'],
    ] },
  };
  if (builds.length !== 1 || !Object.prototype.hasOwnProperty.call(profiles, builds[0])) fail('UNSUPPORTED_CATALOG_CLIENT');
  const profile = profiles[builds[0]];
  if (builds[0] === 'a526397' && action === 'rename_playlist') fail('UNSUPPORTED_CATALOG_CLIENT');
  const methods = profile.methods ?? { search: 'V', tracks: 'Rh', song: 'Oh', add: 'zh', lyrics: 'xg' };
  const node = document.querySelector('[data-testid="tid_createplaylist_section"]');
  let fiber = node?.[Object.keys(node ?? {}).find(k => k.startsWith('__reactInternalInstance') || k.startsWith('__reactFiber'))];
  let store;
  for (let depth = 0; fiber && depth < 100; depth++, fiber = fiber.return) {
    const candidate = fiber.memoizedProps?.value?.store;
    if (typeof candidate?.getState === 'function' && typeof candidate.dispatch === 'function') { store = candidate; break; }
  }
  if (!store) fail('UNSUPPORTED_CATALOG_CLIENT');
  const account = () => {
    const host = store.getState().host;
    const id = String(host?.uid ?? '');
    if (!validId(id) || host?.isAnonymous !== false) fail('PLAYLIST_LOGIN_REQUIRED');
    return id;
  };
  const accountId = account();
  const unchanged = () => { if (account() !== accountId) fail('PLAYLIST_CHANGED'); };
  const queueSnapshot = () => {
    const state = store.getState(), p = state.playing, list = state.playingList?.curPlayingList;
    if (!p || !Array.isArray(list) || list.length > 10000) fail('INVALID_QUEUE_STATE');
    const ordered = list.map(t => ({ id: String(t.resourceId ?? ''), trackId: String(t.trackId ?? ''), catalogId: String(t.track?.id ?? ''), order: t.displayOrder, type: t.resourceType })).sort((a, b) => a.order - b.order);
    if (ordered.some((t, i) => !validId(t.id) || t.id !== t.trackId || t.id !== t.catalogId || t.type !== 'track' || t.order !== i) || new Set(ordered.map(t => t.id)).size !== ordered.length) fail('INVALID_QUEUE_STATE');
    const volume = p.playingVolume;
    if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 1) fail('INVALID_QUEUE_STATE');
    return { trackIds: ordered.map(t => t.id), trackCount: ordered.length, trackId: String(p.onlineResourceId ?? ''), currentQueueId: String(p.curPlaying?.resourceId ?? ''), playing: p.playingState === 2, mode: p.playingMode, volume, volumePercent: Math.round(volume * 100), title: typeof p.resourceName === 'string' ? p.resourceName : null, source: 'desktop_queue_store' };
  };
  if (action === 'queue' && !profile.contracts) return queueSnapshot();
  // Webpack 4 provides no public getter. Capture its loader with a disposable
  // module, use only the already-loaded fixed module, then remove our own entry.
  const chunks = window.webpackJsonp;
  if (!Array.isArray(chunks)) fail('UNSUPPORTED_CATALOG_CLIENT');
  const key = `netease_mcp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  let loader, api, formatLyrics, renameRequest;
  const payload = [[], { [key]: (module, exports, require) => { loader = require; } }, [[key]]];
  try {
    chunks.push(payload);
    api = loader?.c?.[profile.api]?.exports;
    // a526397 was read from the running client, not inferred from its version.
    // Check the fixed factory contracts without executing candidate modules.
    if (profile.contracts) {
      const source = String(loader?.m?.[profile.api] ?? '');
      const playing = String(loader?.m?.[profile.playing] ?? '');
      if (profile.contracts.some(([key, symbol, route]) => !source.includes(`n.d(t,"${key}",(function(){return ${symbol}}))`) ||
        !source.slice(source.indexOf(`${symbol}=`), source.indexOf(`${symbol}=`) + 200).includes(route)) ||
        !loader?.c?.[profile.playing] || !playing.includes('const He="playing"') ||
        !playing.includes('const{tracks:e,from:t,options:a,triggerScene:l}=n') ||
        !playing.includes('switchPlayingMode(e,t)') || !playing.includes('setVolume(e,t)')) fail('UNSUPPORTED_CATALOG_CLIENT');
    }
    // Module 373 became a WebSocket observable in 3.1.40. Never discover or
    // execute guessed module exports; each supported build has a fixed formatter.
    if (action === 'lyrics') formatLyrics = loader?.c?.[profile.formatter]?.exports?.a;
    if (action === 'rename_playlist') {
      const moduleId = profile.renameModule ?? 13;
      const factory = loader?.c?.[moduleId]?.exports?.a;
      const factorySource = String(loader?.m?.[moduleId] ?? '');
      if (typeof factory !== 'function' || (profile.renameModule &&
        (!factorySource.includes('/api/batch/') || !factorySource.includes('/batch/')))) fail('UNSUPPORTED_CATALOG_CLIENT');
      // Client module 364 uses this batch route. Only send the name subrequest.
      renameRequest = factory({ url: '/api/batch', cacheStrategy: { enable: false } });
    }
    if (!api || ['search', 'tracks', 'song', 'add'].some(k => typeof api[methods[k]] !== 'function')) fail('UNSUPPORTED_CATALOG_CLIENT');
  } finally {
    if (loader?.m) delete loader.m[key];
    if (loader?.c) delete loader.c[key];
    const index = chunks.indexOf(payload);
    if (index >= 0) chunks.splice(index, 1);
  }
  if (action === 'queue') return queueSnapshot();
  const noCache = () => ({ skipLocalRpcCache: true, cacheStrategy: { enable: false } });
  const request = async (method, parameters) => {
    try { return await api[method](parameters, noCache()); }
    catch { fail('CATALOG_REQUEST_FAILED'); }
  };
  if (action === 'lyrics') {
    if (!validId(args.trackId)) fail('INVALID_ARGUMENT');
    const sameTrack = () => { unchanged(); if (String(store.getState().playing?.onlineResourceId) !== args.trackId) fail('TRACK_CHANGED'); };
    sameTrack();
    if (typeof api[methods.lyrics] !== 'function' || typeof formatLyrics !== 'function') fail('UNSUPPORTED_CATALOG_CLIENT');
    const response = await request(methods.lyrics, { id: args.trackId, lv: -1, tv: -1, rv: -1, yv: -1 });
    sameTrack();
    if (response?.code !== 200) fail('INVALID_CATALOG_RESPONSE');
    const formatted = formatLyrics(response);
    if (!Array.isArray(formatted?.lyricLines) || formatted.lyricLines.length > 500 || formatted.lyricLines.some(l => typeof l?.lyric !== 'string' || (l.time != null && !Number.isFinite(l.time)))) fail('INVALID_CATALOG_RESPONSE');
    const translations = formatted.tlyricLines;
    const aligned = Array.isArray(translations) && translations.length === formatted.lyricLines.length;
    const timedLyrics = formatted.lyricLines.map((line, i) => ({ timeSeconds: Number.isFinite(line.time) ? line.time : null, text: line.lyric.slice(0, 500),
      ...(aligned && typeof translations[i]?.lyric === 'string' && translations[i].lyric ? { translation: translations[i].lyric.slice(0, 500) } : {}) }));
    sameTrack();
    return { trackId: args.trackId, timedLyrics, lyricStatus: formatted.displayType === 'pure' ? 'instrumental' : timedLyrics.length ? 'available' : 'missing', source: 'client_lyric_api' };
  }
  const song = value => {
    const id = String(value?.id ?? '');
    const artists = value?.artists ?? value?.ar;
    const album = value?.album ?? value?.al;
    if (!validId(id) || typeof value.name !== 'string' || !Array.isArray(artists) || artists.some(a => typeof a.name !== 'string')) fail('INVALID_CATALOG_RESPONSE');
    return { id, title: value.name, artists: artists.map(a => a.name).join('/'), album: album?.name ?? '', durationMs: value.duration ?? value.dt ?? null };
  };
  const songsById = async ids => {
    const values = await request(methods.song, { c: JSON.stringify(ids.map(id => ({ id }))) });
    unchanged();
    if (!Array.isArray(values)) fail('INVALID_CATALOG_RESPONSE');
    const mapped = values.map(song);
    if (mapped.length !== ids.length || new Set(mapped.map(p => p.id)).size !== ids.length || ids.some(id => !mapped.some(p => p.id === id))) fail('TRACK_ID_MISMATCH');
    return { values, mapped };
  };
  if (action === 'search') {
    if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 200 || !Number.isInteger(args.limit) || args.limit < 1 || args.limit > 30) fail('INVALID_ARGUMENT');
    const result = await request(methods.search, { s: args.query, type: 1, limit: args.limit, offset: 0 });
    unchanged();
    if (result?.code !== 200 || !result.result || !Array.isArray(result.result.songs ?? []) || !Number.isFinite(result.result.songCount)) fail('INVALID_CATALOG_RESPONSE');
    const rows = (result.result.songs ?? []).slice(0, args.limit).map(song);
    if (new Set(rows.map(p => p.id)).size !== rows.length) fail('INVALID_CATALOG_RESPONSE');
    return { query: args.query, items: rows.map((p, i) => ({ ...p, index: String(i + 1) })), total: result.result.songCount, source: 'client_api', partial: result.result.songCount > rows.length };
  }
  if (action === 'play_result') {
    if (!validId(args.item?.id)) fail('INVALID_ARGUMENT');
    const { values, mapped } = await songsById([args.item.id]);
    if (['title', 'artists', 'album'].some(k => mapped[0][k] !== args.item[k])) fail('STALE_SEARCH');
    unchanged();
    await store.dispatch({ type: 'playing/play', payload: {
      tracks: values, from: { resourceType: 'track', scene: 'search', text: 'MCP search', href: '', needOpenVinylPage: false,
        fromInfo: { originalScene: 'search', originalResourceType: 'track', computeSourceResourceType: 'track', sourceData: { id: args.item.id, name: args.item.title } } },
      options: { clear: false, play: true, playId: args.item.id }, triggerScene: 'search',
    } });
    return { dispatched: true, trackId: args.item.id };
  }
  if (!validId(args.playlistId)) fail('INVALID_ARGUMENT');
  const readPlaylist = async () => {
    const response = await request(methods.tracks, { id: args.playlistId, n: 100000, s: 0 });
    unchanged();
    const p = response?.playlist;
    if (response?.code !== 200 || String(p?.id) !== args.playlistId || typeof p.name !== 'string' || !Array.isArray(p.trackIds) || !Number.isSafeInteger(p.trackCount) || p.trackCount < 0 || p.trackCount > 100000) fail('INVALID_CATALOG_RESPONSE');
    const trackIds = p.trackIds.map(t => String(t.id));
    if (trackIds.some(id => !validId(id)) || trackIds.length !== p.trackCount || new Set(trackIds).size !== trackIds.length) fail('INCOMPLETE_PLAYLIST_MEMBERS');
    return { id: args.playlistId, title: p.name, owned: String(p.creator?.userId) === accountId,
      system: p.specialType === 5 || String(store.getState()['async:hostResource']?.starPlaylistId) === args.playlistId,
      privacy: p.privacy, trackCount: p.trackCount, trackIds };
  };
  const before = await readPlaylist();
  if (action === 'playlist_tracks') return before;
  if (action === 'rename_playlist') {
    const validName = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 40 && !/[\u0000-\u001f\u007f]/.test(value);
    if (typeof args.expectedName !== 'string' || !validName(args.newName) || !Array.isArray(args.protectedIds) || !args.baseline) fail('INVALID_ARGUMENT');
    const owned = p => {
      const resource = store.getState()['async:hostResource'];
      if (p.system || args.protectedIds.includes(p.id)) fail('PROTECTED_PLAYLIST');
      if (!p.owned || !resource?.createPlaylist?.some(t => String(t.id) === p.id && String(t.userId) === accountId && t.subscribed === false) || resource.favPlaylist?.some(t => String(t.id) === p.id)) fail('NOT_OWNED_PLAYLIST');
    };
    const sameMembers = (a, b) => a.id === b.id && a.owned === b.owned && a.system === b.system && a.privacy === b.privacy && a.trackCount === b.trackCount && JSON.stringify(a.trackIds) === JSON.stringify(b.trackIds);
    owned(before);
    if (!sameMembers(before, args.baseline)) fail(args.readOnlyRecovery ? 'RENAME_OUTCOME_UNKNOWN' : 'PLAYLIST_CHANGED');
    const result = (responseLost, changed = true) => ({ verified: true, changed, playlistId: before.id, previousName: args.expectedName, playlistName: args.newName, trackCount: before.trackCount, privacy: before.privacy, owned: true, membersAndOrderPreserved: true, responseLost, verificationSource: 'uncached_playlist_name_and_exact_members' });
    if (args.readOnlyRecovery) {
      if (before.title !== args.newName) fail('RENAME_OUTCOME_UNKNOWN');
      return result(true);
    }
    if (before.title !== args.expectedName) fail('PLAYLIST_CHANGED');
    if (before.title === args.newName) return result(false, false);
    const latest = await readPlaylist(); owned(latest);
    if (latest.title !== before.title || !sameMembers(latest, before)) fail('PLAYLIST_CHANGED');
    const playback = queueSnapshot();
    unchanged();
    let responseLost = false;
    try {
      const response = await renameRequest({ '/api/playlist/update/name': { id: before.id, name: args.newName } }, noCache());
      if (response?.code !== 200 || response['/api/playlist/update/name']?.code !== 200) responseLost = true;
    } catch { responseLost = true; }
    // Send once. Only reads follow, even when the write reply is missing.
    try {
      const after = await readPlaylist(); owned(after);
      if (after.title !== args.newName || !sameMembers(after, before)) fail('RENAME_OUTCOME_UNKNOWN');
      const current = queueSnapshot();
      if (['trackIds', 'trackId', 'currentQueueId', 'playing', 'mode', 'volume'].some(k => JSON.stringify(current[k]) !== JSON.stringify(playback[k]))) fail('RENAME_OUTCOME_UNKNOWN');
      return { ...result(responseLost), playbackPreserved: true };
    } catch { fail('RENAME_OUTCOME_UNKNOWN'); }
  }
  if (action === 'play_playlist') {
    if (typeof args.expectedName !== 'string' || typeof args.expectedVolume !== 'number') fail('INVALID_ARGUMENT');
    if (before.title !== args.expectedName) fail('PLAYLIST_CHANGED');
    if (!before.trackCount || before.trackCount > 200) fail('PLAYLIST_PLAY_UNSUPPORTED');
    const state = store.getState();
    if (state['async:listenTogether']?.status !== 'alone' || !['playOrder', 'playCycle', 'playOneCycle', 'playRandom'].includes(state.playing?.playingMode)) fail('PLAYLIST_PLAY_UNSUPPORTED');
    const { values, mapped } = await songsById(before.trackIds);
    const tracks = before.trackIds.map(id => values.find(t => String(t.id) === id));
    const latest = await readPlaylist();
    const sameOrder = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);
    if (latest.title !== before.title || latest.owned !== before.owned || latest.privacy !== before.privacy || !sameOrder(latest.trackIds, before.trackIds)) fail('PLAYLIST_CHANGED');
    const initial = queueSnapshot();
    if (initial.volume !== args.expectedVolume) fail('PLAYLIST_CHANGED');
    if (store.getState()['async:listenTogether']?.status !== 'alone' || !['playOrder', 'playCycle', 'playOneCycle', 'playRandom'].includes(initial.mode)) fail('PLAYLIST_PLAY_UNSUPPORTED');
    unchanged();
    // Once either fixed action is sent, failures are uncertain. Never replay a
    // command as part of verification, and never repair volume by writing it.
    try {
      if (initial.mode !== 'playOrder') {
        await store.dispatch({ type: 'playing/switchPlayingMode', payload: { playingMode: 'playOrder', triggerScene: 'playlist' } });
        unchanged();
        const modeRead = queueSnapshot();
        if (modeRead.mode !== 'playOrder' || modeRead.volume !== initial.volume || store.getState()['async:listenTogether']?.status !== 'alone') fail('PLAYLIST_PLAY_OUTCOME_UNKNOWN');
      }
      let responseLost = false;
      try {
        await store.dispatch({ type: 'playing/play', payload: {
          tracks, from: { resourceType: 'track', scene: 'playlist', text: before.title, href: '', needOpenVinylPage: false,
            fromInfo: { originalScene: 'playlist', originalResourceType: 'playlist', computeSourceResourceType: 'track', sourceData: { id: before.id, name: before.title, trackCount: before.trackCount } } },
          options: { clear: true, play: true, playId: before.trackIds[0] }, triggerScene: 'playlist',
        } });
      } catch { responseLost = true; }
      const matches = s => sameOrder(s.trackIds, before.trackIds) && s.trackId === before.trackIds[0] && s.currentQueueId === before.trackIds[0] && s.playing && s.mode === 'playOrder' && s.volume === initial.volume;
      let stable = 0;
      for (let attempt = 0; attempt < 60; attempt++) {
        unchanged();
        const snapshot = queueSnapshot();
        stable = matches(snapshot) ? stable + 1 : 0;
        if (stable >= 3) {
          const members = await readPlaylist();
          if (members.title !== before.title || members.owned !== before.owned || members.privacy !== before.privacy || !sameOrder(members.trackIds, before.trackIds)) fail('PLAYLIST_PLAY_OUTCOME_UNKNOWN');
          const final = queueSnapshot();
          if (!matches(final)) fail('PLAYLIST_PLAY_OUTCOME_UNKNOWN');
          return { verified: true, playlistId: before.id, playlistName: before.title, firstTrack: mapped.find(t => t.id === before.trackIds[0]), ...final, responseLost, volumePreserved: true, verificationSource: 'exact_queue_order_and_playlist_members' };
        }
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      fail('PLAYLIST_PLAY_OUTCOME_UNKNOWN');
    } catch { fail('PLAYLIST_PLAY_OUTCOME_UNKNOWN'); }
  }
  if (!Array.isArray(args.trackIds) || args.trackIds.length < 1 || args.trackIds.length > 50 || args.trackIds.some(id => !validId(id)) || new Set(args.trackIds).size !== args.trackIds.length || !Array.isArray(args.protectedIds)) fail('INVALID_ARGUMENT');
  const requireOwned = p => {
    const resource = store.getState()['async:hostResource'];
    if (p.system || args.protectedIds.includes(p.id)) fail('PROTECTED_PLAYLIST');
    if (!p.owned || !resource?.createPlaylist?.some(t => String(t.id) === p.id && String(t.userId) === accountId && t.subscribed === false) || resource.favPlaylist?.some(t => String(t.id) === p.id)) fail('NOT_OWNED_PLAYLIST');
    if (p.title !== args.expectedName) fail('PLAYLIST_CHANGED');
  };
  requireOwned(before);
  const { mapped } = await songsById(args.trackIds);
  const latest = await readPlaylist();
  requireOwned(latest);
  const sameIds = (a, b) => { const set = new Set(b); return a.length === b.length && a.every(id => set.has(id)); };
  if (!sameIds(latest.trackIds, before.trackIds) || latest.privacy !== before.privacy) fail('PLAYLIST_CHANGED');
  const missing = args.trackIds.filter(id => !before.trackIds.includes(id));
  const present = args.trackIds.filter(id => before.trackIds.includes(id));
  if (!missing.length) return { verified: true, changed: false, playlistId: before.id, tracks: mapped, addedIds: [], alreadyPresentIds: present, trackCount: before.trackCount, verificationSource: 'uncached_playlist_members' };
  if (args.readOnlyRecovery) fail('ADD_OUTCOME_UNKNOWN');
  unchanged();
  let responseLost = false;
  try {
    const result = await request(methods.add, { op: 'add', pid: before.id, trackIds: JSON.stringify(missing) });
    if (result?.code !== 200) responseLost = true;
  } catch { responseLost = true; }
  // A missing reply is not a reason to resend. Only reads follow the one write.
  let after;
  try { after = await readPlaylist(); requireOwned(after); }
  catch { fail('ADD_OUTCOME_UNKNOWN'); }
  const expectedIds = [...before.trackIds, ...missing];
  if (!sameIds(after.trackIds, expectedIds) || after.privacy !== before.privacy) fail('ADD_OUTCOME_UNKNOWN');
  return { verified: true, changed: true, playlistId: before.id, tracks: mapped, addedIds: missing, alreadyPresentIds: present, trackCount: after.trackCount, responseLost, verificationSource: 'uncached_playlist_members' };
}

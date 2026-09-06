// Executed in the client page. Keep self-contained; never access login storage.
export async function playlistBridge(action, args = {}) {
  const fail = code => { throw new Error(code); };
  if (!Array.from(document.scripts).some(s => /\/app\.chunk\.d4e863d\.js(?:$|\?)/.test(s.src))) fail('UNSUPPORTED_PLAYLIST_CLIENT');
  const node = document.querySelector('[data-testid="tid_createplaylist_section"]');
  if (!node) fail('UNSUPPORTED_PLAYLIST_CLIENT');
  let fiber = node[Object.keys(node).find(k => k.startsWith('__reactInternalInstance') || k.startsWith('__reactFiber'))];
  let store;
  for (let depth = 0; fiber && depth < 100; depth++, fiber = fiber.return) {
    const candidate = fiber.memoizedProps?.value?.store;
    if (typeof candidate?.getState === 'function' && typeof candidate.dispatch === 'function') { store = candidate; break; }
  }
  if (!store) fail('UNSUPPORTED_PLAYLIST_CLIENT');
  const snapshot = () => {
    const state = store.getState(), resource = state['async:hostResource'];
    const accountId = String(state.host?.uid ?? '');
    if (!/^\d+$/.test(accountId) || accountId === '0' || state.host.isAnonymous !== false) fail('PLAYLIST_LOGIN_REQUIRED');
    if (!Array.isArray(resource?.createPlaylist) || !Array.isArray(resource.favPlaylist)) fail('UNSUPPORTED_PLAYLIST_CLIENT');
    const systemId = String(resource.starPlaylistId ?? '');
    const entry = p => {
      const id = String(p.id);
      if (!/^\d+$/.test(id) || typeof p.name !== 'string' || !Number.isSafeInteger(p.trackCount) || p.trackCount < 0) fail('INVALID_PLAYLIST_STATE');
      return { id, title: p.name, trackCount: p.trackCount, updateTime: p.updateTime ?? null,
        owned: String(p.userId) === accountId && p.subscribed === false,
        system: id === systemId || p.specialType === 5 };
    };
    const all = resource.createPlaylist.map(entry), collected = resource.favPlaylist.map(entry);
    const systems = all.filter(p => p.system);
    if (systems.length !== 1 || systems[0].id !== systemId || new Set([...all, ...collected].map(p => p.id)).size !== all.length + collected.length) fail('INVALID_PLAYLIST_STATE');
    return { accountId, created: all.filter(p => !p.system), collected, system: systems[0] };
  };
  const before = snapshot();
  if (action === 'refresh') {
    const pending = store.dispatch({ type: 'async:hostResource/fetchHostPlaylist', payload: { uid: before.accountId } });
    if (typeof pending?.then !== 'function') fail('UNSUPPORTED_PLAYLIST_CLIENT');
    await pending;
    const after = snapshot();
    if (after.accountId !== before.accountId) fail('PLAYLIST_CHANGED');
    return after;
  }
  if (action !== 'delete') fail('UNKNOWN_ACTION');
  const expected = args.expected;
  if (!expected || !Array.isArray(args.protectedIds)) fail('INVALID_ARGUMENT');
  if (args.protectedIds.includes(expected.id) || before.system.id === expected.id) fail('PROTECTED_PLAYLIST');
  const target = before.created.find(p => p.id === expected.id);
  if (!target?.owned || target.system || before.collected.some(p => p.id === expected.id)) fail('NOT_OWNED_PLAYLIST');
  if (before.accountId !== expected.accountId || ['title', 'trackCount', 'updateTime'].some(k => target[k] !== expected[k])) fail('PLAYLIST_CHANGED');
  // The playlist type is deliberately fixed. Other types unsubscribe collections.
  await store.dispatch({ type: 'async:hostResource/deletePlaylist', payload: { id: target.id, playlistType: 'user' } });
  return { dispatched: true };
}

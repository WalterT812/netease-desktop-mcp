import { randomUUID } from 'node:crypto';

export class PlaylistController {
  constructor(adapter, { enabled = false, createEnabled = false, protectedIds = [], ttlMs = 120000 } = {}) {
    this.adapter = adapter;
    this.enabled = enabled;
    this.createEnabled = createEnabled;
    this.uncertainCreates = new Set();
    this.protectedIds = new Set(protectedIds);
    this.ttlMs = ttlMs;
    this.tokens = new Map();
    this.uncertain = new Set();
  }
  async snapshot() { return this.adapter.playlistRun('refresh'); }
  async create(name, isPrivate = true) {
    if (!this.createEnabled) throw new Error('PLAYLIST_CREATE_DISABLED');
    if (typeof name !== 'string' || !name.trim() || name !== name.trim() || name.length > 40 || typeof isPrivate !== 'boolean') throw new Error('INVALID_ARGUMENT');
    if (this.uncertainCreates.has(name)) throw new Error('CREATE_OUTCOME_UNKNOWN');
    const before = await this.snapshot();
    if (before.created.some(p => p.title === name)) throw new Error('PLAYLIST_NAME_EXISTS');
    this.uncertainCreates.add(name);
    const result = await this.adapter.playlistRun('create', { name, isPrivate, accountId: before.accountId });
    const after = await this.snapshot();
    const added = after.created.filter(p => !before.created.some(old => old.id === p.id));
    const playlist = added[0];
    if (before.accountId !== after.accountId || added.length !== 1 || playlist.id !== result.id || playlist.title !== name || !playlist.owned || playlist.system || playlist.trackCount !== 0 || playlist.privacy !== (isPrivate ? 10 : 0)) throw new Error('CREATE_NOT_VERIFIED');
    const stable = entries => JSON.stringify(entries.map(p => [p.id, p.title, p.trackCount, p.updateTime, p.privacy]).sort((a, b) => a[0].localeCompare(b[0])));
    if (stable(before.created) !== stable(after.created.filter(p => p.id !== playlist.id)) || stable(before.collected) !== stable(after.collected) || stable([before.system]) !== stable([after.system])) throw new Error('PRESERVATION_CHECK_FAILED');
    this.uncertainCreates.delete(name);
    return { verified: true, playlist, remainingCreated: after.created.length };
  }
  async list() {
    const { accountId, ...result } = await this.snapshot();
    return { ...result, created: result.created.map(p => ({ ...p, protected: this.protectedIds.has(p.id) })), deletionEnabled: this.enabled };
  }
  target(state, id, name) {
    if (this.protectedIds.has(id) || state.system.id === id) throw new Error('PROTECTED_PLAYLIST');
    const target = state.created.find(p => p.id === id);
    if (!target?.owned || target.system || state.collected.some(p => p.id === id)) throw new Error('NOT_OWNED_PLAYLIST');
    if (target.title !== name) throw new Error('PLAYLIST_CHANGED');
    return { ...target, accountId: state.accountId };
  }
  async prepareDelete(id, expectedName) {
    if (!this.enabled) throw new Error('PLAYLIST_DELETE_DISABLED');
    if (this.uncertain.has(id)) throw new Error('DELETE_OUTCOME_UNKNOWN');
    const expected = this.target(await this.snapshot(), id, expectedName);
    for (const [key, value] of this.tokens) if (value.expiresAt <= Date.now()) this.tokens.delete(key);
    if (this.tokens.size >= 32) throw new Error('TOO_MANY_DELETE_PREVIEWS');
    const token = randomUUID(), expiresAt = Date.now() + this.ttlMs;
    this.tokens.set(token, { expected, expiresAt });
    const { accountId, ...target } = expected;
    return { deleteToken: token, target, expiresAt, warning: 'Deletes this owned playlist. Requires explicit user authorization; a track-list backup cannot restore its original ID or followers.' };
  }
  async deletePrepared(token) {
    if (!this.enabled) throw new Error('PLAYLIST_DELETE_DISABLED');
    const prepared = this.tokens.get(token);
    this.tokens.delete(token);
    if (!prepared) throw new Error('INVALID_DELETE_TOKEN');
    if (prepared.expiresAt <= Date.now()) throw new Error('EXPIRED_DELETE_TOKEN');
    const { expected } = prepared;
    if (this.uncertain.has(expected.id)) throw new Error('DELETE_OUTCOME_UNKNOWN');
    const before = await this.snapshot();
    const current = this.target(before, expected.id, expected.title);
    if (['accountId', 'trackCount', 'updateTime'].some(k => current[k] !== expected[k])) throw new Error('PLAYLIST_CHANGED');
    this.uncertain.add(expected.id);
    await this.adapter.playlistRun('delete', { expected, protectedIds: [...this.protectedIds] });
    const after = await this.snapshot();
    if (after.created.some(p => p.id === expected.id)) throw new Error('DELETE_NOT_VERIFIED');
    const fingerprint = entries => JSON.stringify(entries.map(p => [p.id, p.title, p.trackCount, p.updateTime]).sort((a, b) => a[0].localeCompare(b[0])));
    if (before.accountId !== after.accountId || fingerprint(before.created.filter(p => p.id !== expected.id)) !== fingerprint(after.created) || fingerprint(before.collected) !== fingerprint(after.collected) || fingerprint([before.system]) !== fingerprint([after.system])) throw new Error('PRESERVATION_CHECK_FAILED');
    this.uncertain.delete(expected.id);
    return { verified: true, deleted: { id: expected.id, title: expected.title, trackCount: expected.trackCount }, remainingCreated: after.created.length, retainedCollected: after.collected.length };
  }
}

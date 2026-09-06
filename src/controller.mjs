import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export class MusicController {
  constructor(adapter, { timeoutMs = 6000, intervalMs = 150 } = {}) {
    this.adapter = adapter;
    this.timeoutMs = timeoutMs;
    this.intervalMs = intervalMs;
    this.searchState = null;
  }
  async status() {
    const state = await this.adapter.run('status');
    if (!state.trackLabel) throw new Error('NO_CURRENT_TRACK');
    return { ...state,
      trackKey: createHash('sha256').update(state.trackLabel).digest('hex').slice(0, 24),
      identitySource: 'visible_track_label',
    };
  }
  async waitFor(predicate) {
    const end = Date.now() + this.timeoutMs;
    do {
      const state = await this.status();
      if (predicate(state)) return { verified: true, state };
      await delay(this.intervalMs);
    } while (Date.now() < end);
    throw new Error('NOT_VERIFIED: Command was sent once, but the expected state was not observed. Read status before any retry.');
  }
  async setPlayback(action) {
    if (!['play', 'pause'].includes(action)) throw new Error('INVALID_ARGUMENT');
    const desired = action === 'play';
    const before = await this.status();
    if (before.playing === null) throw new Error('UNKNOWN_PLAYBACK_STATE');
    if (before.playing === desired) return { verified: true, changed: false, state: before };
    await this.adapter.run('playback', { playing: desired });
    return this.waitFor(s => s.playing === desired);
  }
  async setLiked(desired, trackKey) {
    if (typeof desired !== 'boolean') throw new Error('INVALID_ARGUMENT');
    const before = await this.status();
    if (!trackKey || before.trackKey !== trackKey) throw new Error('TRACK_CHANGED: Read current status before liking.');
    if (before.liked === null) throw new Error('UNKNOWN_LIKE_STATE: This client layout is not supported for heart mutations.');
    if (before.liked === desired) return { verified: true, changed: false, state: before };
    await this.adapter.run('like', { trackLabel: before.trackLabel, liked: desired });
    return this.waitFor(s => {
      if (s.trackKey !== trackKey) throw new Error('TRACK_CHANGED_AFTER_ACTION: The previous like action needs manual verification; do not retry.');
      return s.liked === desired;
    });
  }
  async skip(direction) {
    if (!['next', 'previous'].includes(direction)) throw new Error('INVALID_ARGUMENT');
    const before = await this.status();
    await this.adapter.run('skip', { direction });
    return this.waitFor(s => s.trackKey !== before.trackKey);
  }
  async search(query, limit = 10) {
    if (typeof query !== 'string' || !query.trim() || query.length > 200 || !Number.isInteger(limit) || limit < 1 || limit > 30) throw new Error('INVALID_ARGUMENT');
    this.searchState = null;
    const result = await this.adapter.run('search', { query: query.trim() });
    this.searchState = { searchToken: randomUUID(), createdAt: Date.now(), ...result, items: result.items.slice(0, limit) };
    return { searchToken: this.searchState.searchToken, query: result.query, items: this.searchState.items, partial: true, expiresInSeconds: 120 };
  }
  async playResult(searchToken, index) {
    const saved = this.searchState;
    if (!saved || saved.searchToken !== searchToken || Date.now() - saved.createdAt > 120000) throw new Error('STALE_SEARCH: Search again.');
    const items = saved.items.filter(i => i.index === index);
    if (items.length !== 1) throw new Error('UNKNOWN_SEARCH_RESULT');
    const item = items[0];
    // Consume BEFORE any possible dispatch: even a lost reply must not permit a repeat.
    this.searchState = null;
    await this.adapter.run('play_result', { query: saved.query, item });
    const normalize = value => value.normalize('NFC').replace(/\s+[—–-]\s+/g, ' - ').replace(/\s+/g, ' ').trim();
    if (!item.artists) throw new Error('NOT_VERIFIED: Search result has no artist identity.');
    const expected = normalize(`${item.title} - ${item.artists}`);
    return this.waitFor(s => s.playing === true && normalize(s.trackLabel) === expected);
  }
}

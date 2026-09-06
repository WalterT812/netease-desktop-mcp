export class CatalogController {
  constructor(adapter, { addEnabled = false, protectedIds = [] } = {}) {
    this.adapter = adapter;
    this.addEnabled = addEnabled;
    this.protectedIds = [...protectedIds];
    this.uncertain = new Map();
  }
  async tracks(playlistId, offset = 0, limit = 100) {
    const value = await this.adapter.catalogRun('playlist_tracks', { playlistId });
    return { ...value, trackIds: value.trackIds.slice(offset, offset + limit), offset, limit, complete: offset === 0 && limit >= value.trackCount, verificationSource: 'uncached_playlist_members' };
  }
  async add(playlistId, expectedName, trackIds) {
    if (!this.addEnabled) throw new Error('PLAYLIST_ADD_DISABLED');
    if (this.protectedIds.includes(playlistId)) throw new Error('PROTECTED_PLAYLIST');
    const previous = this.uncertain.get(playlistId);
    const recovery = !!previous;
    if (recovery && (previous.expectedName !== expectedName || JSON.stringify(previous.trackIds) !== JSON.stringify(trackIds))) throw new Error('ADD_OUTCOME_UNKNOWN');
    this.uncertain.set(playlistId, { expectedName, trackIds: [...trackIds] });
    try {
      const result = await this.adapter.catalogRun('add_tracks', { playlistId, expectedName, trackIds, protectedIds: this.protectedIds, readOnlyRecovery: recovery });
      this.uncertain.delete(playlistId);
      return result;
    } catch (error) {
      if (!recovery && ['INVALID_ARGUMENT', 'PROTECTED_PLAYLIST', 'NOT_OWNED_PLAYLIST', 'PLAYLIST_CHANGED', 'PLAYLIST_LOGIN_REQUIRED', 'INCOMPLETE_PLAYLIST_MEMBERS', 'INVALID_CATALOG_RESPONSE', 'TRACK_ID_MISMATCH', 'CATALOG_REQUEST_FAILED', 'UNSUPPORTED_CATALOG_CLIENT'].includes(error.message)) this.uncertain.delete(playlistId);
      throw error;
    }
  }
}

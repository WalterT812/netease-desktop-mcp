// Cache only the current song's bounded public lyric projection, never account data.
export class LyricsController {
  constructor(adapter, { now = Date.now } = {}) { this.adapter = adapter; this.now = now; this.cached = null; }
  async read(trackId) {
    if (this.cached?.trackId === trackId && this.cached.expires > this.now()) return this.cached.value;
    this.cached = null;
    let value;
    try {
      value = await this.adapter.lyricsRead(trackId);
      if (value?.trackId !== trackId || !Array.isArray(value.timedLyrics)) throw Error('TRACK_CHANGED');
    } catch (error) {
      if (/TRACK_CHANGED|PLAYLIST_CHANGED|PLAYLIST_LOGIN_REQUIRED/.test(error.message)) throw error;
      value = { trackId, timedLyrics: null, lyricStatus: 'unavailable', source: 'client_lyric_api' };
    }
    this.cached = { trackId, value, expires: this.now() + (value.lyricStatus === 'available' || value.lyricStatus === 'instrumental' ? 600000 : 15000) };
    return value;
  }
  project(value, positionSeconds) {
    const lines = value.timedLyrics;
    let index = null, latest = -Infinity;
    if (Array.isArray(lines) && Number.isFinite(positionSeconds)) {
      index = -1;
      lines.forEach((line, i) => { if (Number.isFinite(line.timeSeconds) && line.timeSeconds <= positionSeconds && line.timeSeconds >= latest) { index = i; latest = line.timeSeconds; } });
    }
    return { lyrics: Array.isArray(lines) ? lines.map(l => l.text) : null, timedLyrics: lines, lyricLine: index, lyricTrackId: value.trackId, lyricStatus: value.lyricStatus, lyricSource: value.source };
  }
}

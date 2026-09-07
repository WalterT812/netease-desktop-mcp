import { Cdp } from './cdp.mjs';
import { inspectDom } from './dom.mjs';
import { inspectWindows } from './windows.mjs';
import { ControllerLease } from './lease.mjs';
import { playlistBridge } from './playlist-bridge.mjs';
import { playerBridge } from './player-bridge.mjs';
import { catalogBridge } from './catalog-bridge.mjs';

export class DesktopAdapter {
  constructor({ executable = process.env.NETEASE_MUSIC_PATH, port = Number(process.env.NETEASE_MCP_PORT ?? 9229) } = {}) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('INVALID_PORT');
    this.executable = executable;
    this.port = port;
    this.cdp = null;
    this.stopped = false;
    this.connections = new Set();
    this.lease = new ControllerLease(`\\\\.\\pipe\\netease-desktop-mcp-${port}`);
  }
  async beginOperation() {
    this.assertOpen();
    if (process.platform !== 'win32') throw new Error('WINDOWS_REQUIRED');
    if (!this.executable) throw new Error('CONFIG_REQUIRED: Set NETEASE_MUSIC_PATH to cloudmusic.exe.');
    await this.lease.acquire();
  }
  async endOperation() { await this.lease.release(); }
  assertOpen() { if (this.stopped) throw new Error('ADAPTER_CLOSED'); }
  stop() {
    this.stopped = true;
    this.cdp?.disconnect();
    this.cdp = null;
    for (const connection of this.connections) connection.disconnect();
  }
  async connect() {
    this.assertOpen();
    if (this.cdp?.socket.readyState === WebSocket.OPEN) return;
    this.cdp?.disconnect();
    this.cdp = null;
    await inspectWindows(this.executable, this.port);
    this.assertOpen();
    const candidates = [];
    try {
      const response = await fetch(`http://127.0.0.1:${this.port}/json/list`, { signal: AbortSignal.timeout(4000), redirect: 'error' });
      if (!response.ok) throw new Error('DISCOVERY_FAILED');
      const text = await response.text();
      this.assertOpen();
      if (text.length > 1024 * 1024) throw new Error('DISCOVERY_TOO_LARGE');
      const targets = JSON.parse(text);
      if (!Array.isArray(targets) || targets.length > 30) throw new Error('INVALID_TARGETS');
      const matches = [];
      for (const target of targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl)) {
        this.assertOpen();
        const connection = await Cdp.connect(target.webSocketDebuggerUrl, this.port);
        candidates.push(connection);
        this.connections.add(connection);
        this.assertOpen();
        try {
          const probe = await connection.evaluate(inspectDom, { action: 'probe' });
          if (probe?.recognized) matches.push(connection);
          else connection.disconnect();
        } catch { connection.disconnect(); }
      }
      this.assertOpen();
      if (matches.length !== 1) {
        for (const connection of matches) connection.disconnect();
        throw new Error(matches.length ? 'AMBIGUOUS_MUSIC_TARGET' : 'UNSUPPORTED_CLIENT: Main player UI was not recognized. Open the standard music window with a current track.');
      }
      this.cdp = matches[0];
      // Recheck ownership after discovery to reduce local port-reuse races.
      await inspectWindows(this.executable, this.port);
      this.assertOpen();
    } catch (error) { this.cdp?.disconnect(); this.cdp = null; throw error; }
    finally {
      for (const connection of candidates) {
        if (connection !== this.cdp) connection.disconnect();
        this.connections.delete(connection);
      }
    }
  }
  async run(action, args = {}) {
    await this.connect();
    this.assertOpen();
    const cdp = this.cdp;
    if (action === 'search' || (action === 'play_result' && args.item?.id)) return this.catalogRun(action, args);
    return cdp.evaluate(inspectDom, { action, args });
  }
  async catalogRun(action, args = {}) {
    await this.connect();
    this.assertOpen();
    return this.cdp.evaluate(catalogBridge, { action, args }, 70000);
  }
  async playlistRun(action, args = {}) {
    await this.connect();
    this.assertOpen();
    return this.cdp.evaluate(playlistBridge, { action, args }, 20000);
  }
  async playerRead(){await this.connect();this.assertOpen();return this.cdp.evaluate(playerBridge,{action:'read'});}
  async lyricsRead(trackId){await this.connect();this.assertOpen();return this.cdp.evaluate(catalogBridge,{action:'lyrics',args:{trackId}},10000);}
  async playerControl(action,args){await this.connect();this.assertOpen();return this.cdp.evaluate(playerBridge,{action,args});}
  async disconnect() {
    this.stop();
    await this.endOperation();
  }
}

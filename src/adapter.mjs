import { mkdir, open, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Cdp } from './cdp.mjs';
import { inspectDom } from './dom.mjs';
import { inspectWindows } from './windows.mjs';

export class DesktopAdapter {
  constructor({ executable = process.env.NETEASE_MUSIC_PATH, port = Number(process.env.NETEASE_MCP_PORT ?? 9229) } = {}) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('INVALID_PORT');
    this.executable = executable;
    this.port = port;
    this.cdp = null;
    this.lock = null;
    this.lockPath = fileURLToPath(new URL(`../.netease-mcp/port-${port}.lock`, import.meta.url));
  }
  async connect() {
    if (this.cdp) return;
    await inspectWindows(this.executable, this.port);
    await mkdir(fileURLToPath(new URL('../.netease-mcp/', import.meta.url)), { recursive: true });
    try { this.lock = await open(this.lockPath, 'wx'); }
    catch { throw new Error('CONTROLLER_BUSY: Another session or an unclean exit holds the lock. Check its PID before removing a stale .netease-mcp lock.'); }
    const candidates = [];
    try {
      await this.lock.writeFile(String(process.pid));
      const response = await fetch(`http://127.0.0.1:${this.port}/json/list`, { signal: AbortSignal.timeout(4000), redirect: 'error' });
      if (!response.ok) throw new Error('DISCOVERY_FAILED');
      const text = await response.text();
      if (text.length > 1024 * 1024) throw new Error('DISCOVERY_TOO_LARGE');
      const targets = JSON.parse(text);
      if (!Array.isArray(targets) || targets.length > 30) throw new Error('INVALID_TARGETS');
      const matches = [];
      for (const target of targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl)) {
        const connection = await Cdp.connect(target.webSocketDebuggerUrl, this.port);
        candidates.push(connection);
        try {
          const probe = await connection.evaluate(inspectDom, { action: 'probe' });
          if (probe?.recognized) matches.push(connection);
          else connection.disconnect();
        } catch { connection.disconnect(); }
      }
      if (matches.length !== 1) {
        for (const connection of matches) connection.disconnect();
        throw new Error(matches.length ? 'AMBIGUOUS_MUSIC_TARGET' : 'UNSUPPORTED_CLIENT: Main player UI was not recognized. Open the standard music window with a current track.');
      }
      this.cdp = matches[0];
      // Recheck ownership after discovery to reduce local port-reuse races.
      await inspectWindows(this.executable, this.port);
    } catch (error) { await this.disconnect(); throw error; }
    finally { for (const connection of candidates) if (connection !== this.cdp) connection.disconnect(); }
  }
  async run(action, args = {}) {
    await this.connect();
    if (action !== 'search') return this.cdp.evaluate(inspectDom, { action, args });
    const focused = await this.cdp.evaluate(inspectDom, { action: 'focus_search' });
    if (!focused?.focused) throw new Error('SEARCH_FOCUS_FAILED');
    await this.cdp.send('Input.insertText', { text: args.query });
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    const wait = async operation => {
      const end = Date.now() + 6000;
      do {
        try { return await this.cdp.evaluate(inspectDom, { action: operation, args }); }
        catch (error) { if (!['CONTROL_NOT_FOUND', 'SEARCH_PENDING'].includes(error.message)) throw error; }
        await delay(150);
      } while (Date.now() < end);
      throw new Error('SEARCH_TIMEOUT');
    };
    await wait('search_tab');
    return wait('search_results');
  }
  async disconnect() {
    this.cdp?.disconnect();
    this.cdp = null;
    if (this.lock) {
      await this.lock.close();
      this.lock = null;
      await unlink(this.lockPath).catch(() => {});
    }
  }
}

export function validateEndpoint(address, port) {
  const url = new URL(address);
  if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || Number(url.port) !== port || url.username || url.password || !/^\/devtools\/page\/[\w-]+$/.test(url.pathname) || url.search || url.hash) {
    throw new Error('UNSAFE_ENDPOINT');
  }
  return url;
}

export class Cdp {
  constructor(socket, timeoutMs = 5000) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.sequence = 0;
    this.pending = new Map();
    socket.addEventListener('message', ({ data }) => {
      let message;
      try { message = JSON.parse(data); } catch { this.fail(new Error('INVALID_CDP_MESSAGE')); return; }
      const job = this.pending.get(message.id);
      if (!job) return;
      clearTimeout(job.timer);
      this.pending.delete(message.id);
      if (message.error) job.reject(new Error(`CDP_ERROR: ${message.error.code}`));
      else job.resolve(message.result);
    });
    socket.addEventListener('close', () => this.fail(new Error('CDP_DISCONNECTED: Result unknown; read status before retrying.')));
    socket.addEventListener('error', () => this.fail(new Error('CDP_CONNECTION_ERROR')));
  }
  static async connect(address, port, timeoutMs = 5000) {
    validateEndpoint(address, port);
    const socket = new WebSocket(address);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('CDP_CONNECT_TIMEOUT')); }, timeoutMs);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP_CONNECT_FAILED')); }, { once: true });
    });
    return new Cdp(socket, timeoutMs);
  }
  fail(error) {
    for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(error); }
    this.pending.clear();
  }
  send(method, params = {}) {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('CDP_DISCONNECTED'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('CDP_TIMEOUT: Result unknown; command will not be retried.'));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new Error('CDP_SEND_FAILED')); }
    });
  }
  async evaluate(fn, args) {
    const result = await this.send('Runtime.evaluate', {
      expression: `(${fn.toString()})(${JSON.stringify(args.action)},${JSON.stringify(args.args ?? {})})`,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      // Expose only our known adapter error code, never a page stack or arbitrary DOM text.
      const description = result.exceptionDetails.exception?.description ?? '';
      const code = description.match(/\b(?:AMBIGUOUS_CONTROL|CONTROL_NOT_FOUND|UNSUPPORTED_CONTROL_LAYOUT|TRACK_CHANGED|UNKNOWN_LIKE_STATE|UNKNOWN_PLAYBACK_STATE|SEARCH_PENDING|STALE_SEARCH|AMBIGUOUS_RESULT|INVALID_ARGUMENT|UNKNOWN_ACTION)\b/)?.[0];
      throw new Error(code || 'UI_EVALUATION_FAILED');
    }
    return result.result?.value;
  }
  disconnect() { this.fail(new Error('CDP_DISCONNECTED')); this.socket.close(); }
}

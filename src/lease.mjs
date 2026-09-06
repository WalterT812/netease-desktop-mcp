import { createServer } from 'node:net';

// An OS-owned IPC endpoint disappears when its process exits, even on forced exit.
// The pipe does not accept commands or expose data; it is an exclusive operation lease.
export class ControllerLease {
  constructor(endpoint) { this.endpoint = endpoint; this.server = null; }
  async acquire() {
    if (this.server) throw new Error('CONTROLLER_BUSY');
    const server = createServer(socket => socket.destroy());
    await new Promise((resolve, reject) => {
      server.once('error', () => reject(new Error('CONTROLLER_BUSY: Another music operation is in progress. Try after it finishes.')));
      server.listen(this.endpoint, resolve);
    });
    this.server = server;
    server.unref();
  }
  async release() {
    const server = this.server;
    this.server = null;
    if (server) await new Promise(resolve => server.close(resolve));
  }
}

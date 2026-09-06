import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from '../src/server.mjs';
import { DesktopAdapter } from '../src/adapter.mjs';
import { PassThrough } from 'node:stream';
import { closeOnInputEnd } from '../src/server.mjs';
import { PlaylistController } from '../src/playlists.mjs';

test('SDK playlist tools preserve protections, schemas and single-use deletion semantics', async t => {
  const state = { accountId: '9', created: [{ id: '11', title: 'Remove', trackCount: 2, updateTime: 1, owned: true, system: false }], collected: [], system: { id: '1', title: 'Liked', trackCount: 4 } };
  let dispatches = 0;
  const playlists = new PlaylistController({ async playlistRun(action) {
    if (action === 'delete') { dispatches++; state.created = []; return { dispatched: true }; }
    return structuredClone(state);
  } }, { enabled: true });
  const server = createServer({}, { playlists });
  const client = new Client({ name: 'playlist-contract', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(b); await client.connect(a);
  const tools = (await client.listTools()).tools;
  assert.equal(tools.find(t => t.name === 'netease_delete_playlist').annotations.destructiveHint, true);
  assert.equal(tools.find(t => t.name === 'netease_delete_playlist').annotations.idempotentHint, false);
  const call = (name, args = {}) => client.callTool({ name, arguments: args });
  const library = await call('netease_list_playlists');
  assert.equal(library.structuredContent.result.accountId, undefined);
  assert.equal((await call('netease_prepare_playlist_delete', { id: '1', expectedName: 'Liked' })).isError, true);
  const preview = await call('netease_prepare_playlist_delete', { id: '11', expectedName: 'Remove' });
  const token = preview.structuredContent.result.deleteToken;
  assert.equal((await call('netease_delete_playlist', { token, id: '20' })).isError, true);
  const result = await call('netease_delete_playlist', { token });
  assert.equal(result.structuredContent.result.verified, true);
  assert.equal((await call('netease_delete_playlist', { token })).isError, true);
  assert.equal(dispatches, 1);
});

test('stdio EOF immediately stops the server and closes after draining', async () => {
  const input = new PassThrough();
  const events = [];
  const drained = Promise.withResolvers();
  closeOnInputEnd(input, {
    shutdown() { events.push('stop'); return drained.promise; },
    async close() { events.push('close'); },
  });
  input.resume();
  input.end();
  await delay(10);
  assert.deepEqual(events, ['stop']);
  drained.resolve();
  await delay(10);
  assert.deepEqual(events, ['stop', 'close']);
});

test('transport closure cancels queued operations and drains before final cleanup', async () => {
  const events = [];
  const started = Promise.withResolvers();
  const gate = Promise.withResolvers();
  const server = createServer({
    async status() { events.push('start'); started.resolve(); await gate.promise; events.push('end'); return {}; },
    async skip() { events.push('unexpected-skip'); return {}; },
  }, {
    beforeOperation: async () => events.push('acquire'),
    afterOperation: async () => events.push('release'),
    onShutdown: () => events.push('stop'),
    onDrained: async () => events.push('cleanup'),
  });
  const client = new Client({ name: 'shutdown-test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  const first = client.callTool({ name: 'netease_get_status', arguments: {} }).catch(() => {});
  await started.promise;
  const second = client.callTool({ name: 'netease_skip_track', arguments: { direction: 'next' } }).catch(() => {});
  await delay(20);
  await client.close();
  assert.deepEqual(events, ['acquire', 'start', 'stop']);
  gate.resolve();
  await server.shutdown();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['acquire', 'start', 'stop', 'end', 'release', 'cleanup']);
  await server.shutdown();
  assert.equal(events.filter(e => e === 'cleanup').length, 1);
});

test('stopped desktop adapter refuses reconnection and preserves lease until cleanup', async () => {
  const adapter = new DesktopAdapter({ executable: 'fixture.exe' });
  let released = false;
  let disconnected = false;
  adapter.lease.release = async () => { released = true; };
  adapter.cdp = { disconnect() { disconnected = true; } };
  adapter.stop();
  assert.equal(disconnected, true);
  assert.equal(released, false);
  await assert.rejects(adapter.run('status'), /ADAPTER_CLOSED/);
  await assert.rejects(adapter.beginOperation(), /ADAPTER_CLOSED/);
  await adapter.disconnect();
  assert.equal(released, true);
});

async function connectInMemory(t, controller) {
  const server = createServer(controller);
  const client = new Client({ name: 'memory-contract-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

test('real SDK memory transport preserves successful structured tool results', async t => {
  const state = {
    trackLabel: 'Example Song — Example Artist',
    playing: true,
    liked: false,
    trackKey: '0123456789abcdef01234567',
    identitySource: 'visible_track_label',
  };
  const client = await connectInMemory(t, { async status() { return state; } });
  // Discovering tools also lets the SDK validate the advertised output schema.
  await client.listTools();
  const result = await client.callTool({ name: 'netease_get_status', arguments: {} });
  assert.notEqual(result.isError, true);
  assert.deepEqual(result.structuredContent, { result: state });
  assert.equal(result.content[0].type, 'text');
  assert.deepEqual(JSON.parse(result.content[0].text), state);
});

test('concurrent SDK tool calls serialize entire asynchronous controller operations', async t => {
  let active = 0;
  let maxActive = 0;
  const events = [];
  const operation = async (name, result) => {
    active++;
    maxActive = Math.max(maxActive, active);
    events.push(`start:${name}`);
    try {
      // Model the asynchronous page action and subsequent state verification.
      await delay(10);
      events.push(`verify:${name}`);
      await delay(10);
      return result;
    } finally {
      events.push(`end:${name}`);
      active--;
    }
  };
  const controller = {
    search(query, limit) { return operation('search', { query, limit, items: [] }); },
    setPlayback(action) { return operation('playback', { verified: true, action }); },
    status() { return operation('status', { playing: false }); },
  };
  const client = await connectInMemory(t, controller);
  await client.listTools();
  const results = await Promise.all([
    client.callTool({ name: 'netease_search', arguments: { query: 'Example', limit: 3 } }),
    client.callTool({ name: 'netease_set_playback', arguments: { action: 'pause' } }),
    client.callTool({ name: 'netease_get_status', arguments: {} }),
  ]);
  assert.equal(maxActive, 1);
  assert.equal(active, 0);
  assert.deepEqual(events, [
    'start:search', 'verify:search', 'end:search',
    'start:playback', 'verify:playback', 'end:playback',
    'start:status', 'verify:status', 'end:status',
  ]);
  assert.ok(results.every(result => result.isError !== true));
  assert.deepEqual(results.map(result => result.structuredContent.result), [
    { query: 'Example', limit: 3, items: [] },
    { verified: true, action: 'pause' },
    { playing: false },
  ]);
});

test('real SDK stdio handshake, nine tools, and structured tool failure', async t => {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
    env: { ...process.env, NETEASE_MUSIC_PATH: '' }, stderr: 'pipe' });
  const client = new Client({ name: 'contract-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(transport);
  const listed = await client.listTools();
  assert.equal(listed.tools.length, 9);
  assert.equal(listed.tools.find(t => t.name === 'netease_get_status').annotations.readOnlyHint, true);
  const result = await client.callTool({ name: 'netease_get_status', arguments: {} });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /CONFIG_REQUIRED|WINDOWS_REQUIRED/);
  const invalid = await client.callTool({ name: 'netease_set_liked', arguments: { liked: 'yes' } });
  assert.equal(invalid.isError, true);
});

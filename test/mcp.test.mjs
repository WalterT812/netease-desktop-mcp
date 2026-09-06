import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from '../src/server.mjs';

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

test('real SDK stdio handshake, six tools, and structured tool failure', async t => {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
    env: { ...process.env, NETEASE_MUSIC_PATH: '' }, stderr: 'pipe' });
  const client = new Client({ name: 'contract-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(transport);
  const listed = await client.listTools();
  assert.equal(listed.tools.length, 6);
  assert.equal(listed.tools.find(t => t.name === 'netease_get_status').annotations.readOnlyHint, true);
  const result = await client.callTool({ name: 'netease_get_status', arguments: {} });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /CONFIG_REQUIRED|WINDOWS_REQUIRED/);
  const invalid = await client.callTool({ name: 'netease_set_liked', arguments: { liked: 'yes' } });
  assert.equal(invalid.isError, true);
});

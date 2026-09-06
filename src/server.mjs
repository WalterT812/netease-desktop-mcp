#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { DesktopAdapter } from './adapter.mjs';
import { MusicController } from './controller.mjs';
import { PlaylistController } from './playlists.mjs';

export function createServer(controller, {
  beforeOperation = async () => {}, afterOperation = async () => {},
  onShutdown = () => {}, onDrained = async () => {},
  playlists,
} = {}) {
  const server = new McpServer({ name: 'netease-desktop-mcp', version: '0.1.0-alpha.4' });
  let queue = Promise.resolve();
  let stopped = false;
  let shutdownPromise;
  server.shutdown = () => {
    if (!shutdownPromise) {
      stopped = true;
      onShutdown();
      shutdownPromise = queue.then(onDrained);
    }
    return shutdownPromise;
  };
  server.server.onclose = () => { server.shutdown().catch(() => {}); };
  const register = (name, description, schema, options, operation) => {
    server.registerTool(name, {
      title: name, description, inputSchema: z.object(schema).strict(),
      outputSchema: { result: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true, ...options },
    }, args => {
      const job = queue.then(async () => {
        let acquired = false;
        try {
          if (stopped) throw new Error('SERVER_CLOSED');
          await beforeOperation();
          acquired = true;
          if (stopped) throw new Error('SERVER_CLOSED');
          const result = await operation(args);
          return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: { result } };
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: error.message }] };
        } finally {
          if (acquired) await afterOperation();
        }
      });
      queue = job.catch(() => {});
      return job;
    });
  };
  register('netease_get_status', 'Read the current visible song label, playback and heart state. null means unknown. trackKey hashes the visible title/artist, not a unique catalog ID; identical labels are indistinguishable.', {}, { readOnlyHint: true, idempotentHint: true }, () => controller.status());
  register('netease_search', 'Search songs in the desktop UI. Changes the visible search page; returns a partial list and a token valid for two minutes in this MCP session. Does not play music.', {
    query: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(30).default(10),
  }, {}, ({ query, limit }) => controller.search(query, limit));
  register('netease_play_result', 'Play an exact row from the latest search. Requires its token and string index. Refuses changed/stale rows. Success means the UI shows the chosen title/artist playing; it does not prove audible output.', {
    searchToken: z.string().uuid(), index: z.string().min(1).max(12),
  }, {}, ({ searchToken, index }) => controller.playResult(searchToken, index));
  register('netease_set_playback', 'Explicitly play or pause and verify the UI state. Does not blindly toggle. Unknown UI state refuses the action.', {
    action: z.enum(['play', 'pause']),
  }, { idempotentHint: true }, ({ action }) => controller.setPlayback(action));
  register('netease_skip_track', 'Move to next/previous track once and verify a changed visible song label. Unchanged/identical labels are reported as unverified; do not automatically retry.', {
    direction: z.enum(['next', 'previous']),
  }, {}, ({ direction }) => controller.skip(direction));
  register('netease_set_liked', 'Set the current song heart only when explicitly requested. Supply trackKey from a fresh status result. Refuses unknown heart state or changed labels. Visible UI verification is not server-side persistence verification.', {
    liked: z.boolean(), trackKey: z.string().regex(/^[a-f0-9]{24}$/),
  }, { destructiveHint: true, idempotentHint: true }, ({ liked, trackKey }) => controller.setLiked(liked, trackKey));
  const library = () => { if (!playlists) throw new Error('PLAYLIST_CONTROLLER_UNAVAILABLE'); return playlists; };
  register('netease_create_playlist', 'Create one empty owned playlist after user authorization. Private by default. Requires NETEASE_ENABLE_PLAYLIST_CREATE=1. Refuses an existing exact name; verifies returned ID, ownership, privacy and preservation of other playlists. Never retry an uncertain result automatically.', {
    name: z.string().trim().min(1).max(40), isPrivate: z.boolean().default(true),
  }, {}, ({ name, isPrivate }) => library().create(name, isPrivate));
  register('netease_list_playlists', 'Refresh owned, collected and system playlists through the desktop client. Does not move the mouse, focus or navigate. Account identifiers are omitted.', {}, { readOnlyHint: true, idempotentHint: true }, () => library().list());
  register('netease_prepare_playlist_delete', 'Preview deletion of an exact owned playlist ID and name; returns a single-use token valid for two minutes. Requires NETEASE_ENABLE_PLAYLIST_DELETE=1. Collected, system and configured protected playlists are refused. Preview is not user consent.', {
    id: z.string().regex(/^\d+$/), expectedName: z.string().min(1).max(500),
  }, { readOnlyHint: true }, ({ id, expectedName }) => library().prepareDelete(id, expectedName));
  register('netease_delete_playlist', 'After explicit user authorization, consume a deletion preview token and delete that owned playlist once. Rechecks account, name, count, update time and protections, then verifies removal and preservation of other playlists. Never automatically retry an uncertain result. Track-list backups cannot restore original IDs or followers.', {
    token: z.string().uuid(),
  }, { destructiveHint: true }, ({ token }) => library().deletePrepared(token));
  return server;
}

export function closeOnInputEnd(input, server) {
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    server.shutdown().then(() => server.close()).catch(() => {});
  };
  for (const event of ['end', 'close', 'error']) input.once(event, close);
}

async function main() {
  const adapter = new DesktopAdapter();
  const server = createServer(new MusicController(adapter), {
    playlists: new PlaylistController(adapter, { enabled: process.env.NETEASE_ENABLE_PLAYLIST_DELETE === '1', createEnabled: process.env.NETEASE_ENABLE_PLAYLIST_CREATE === '1', protectedIds: (process.env.NETEASE_PROTECTED_PLAYLIST_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean) }),
    beforeOperation: () => adapter.beginOperation(), afterOperation: () => adapter.endOperation(),
    onShutdown: () => adapter.stop(), onDrained: () => adapter.disconnect(),
  });
  closeOnInputEnd(process.stdin, server);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
    const drained = server.shutdown();
    await server.close();
    await drained;
    process.exit(0);
  });
  await server.connect(new StdioServerTransport());
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

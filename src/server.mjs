#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { DesktopAdapter } from './adapter.mjs';
import { MusicController } from './controller.mjs';

export function createServer(controller) {
  const server = new McpServer({ name: 'netease-desktop-mcp', version: '0.1.0-alpha.1' });
  let queue = Promise.resolve();
  const register = (name, description, schema, options, operation) => {
    server.registerTool(name, {
      title: name, description, inputSchema: z.object(schema).strict(),
      outputSchema: { result: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true, ...options },
    }, args => {
      const job = queue.then(async () => {
        try {
          const result = await operation(args);
          return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: { result } };
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: error.message }] };
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
  return server;
}

async function main() {
  const adapter = new DesktopAdapter();
  const server = createServer(new MusicController(adapter));
  server.server.onclose = () => { adapter.disconnect().catch(() => {}); };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
    await server.close();
    await adapter.disconnect();
    process.exit(0);
  });
  await server.connect(new StdioServerTransport());
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

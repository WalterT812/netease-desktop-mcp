#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { DesktopAdapter } from './adapter.mjs';
import { MusicController } from './controller.mjs';
import { PlaylistController } from './playlists.mjs';
import { CatalogController } from './catalog.mjs';
import {PlayerController} from './player.mjs';
import {registerPlayerResource,PLAYER_URI} from './widget.mjs';

export function createServer(controller, {
  beforeOperation = async () => {}, afterOperation = async () => {},
  onShutdown = () => {}, onDrained = async () => {},
  playlists, player, catalog,
} = {}) {
  const server = new McpServer({ name: 'netease-desktop-mcp', version: '0.1.0-alpha.13' });
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
  const register = (name, description, schema, options, operation, meta={}) => {
    server.registerTool(name, {
      title: name, description, inputSchema: z.object(schema).strict(),
      outputSchema: { result: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true, ...options },
      _meta:{ui:{visibility:['netease_get_player','netease_get_status','netease_set_playback','netease_skip_track','netease_set_liked','netease_seek','netease_set_volume','netease_list_playlists'].includes(name)?['model','app']:['model']},...meta},
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
  registerPlayerResource(server);
  const snapshot=()=>{if(!player)throw Error('PLAYER_UNAVAILABLE');return player.snapshot();};
  register('netease_get_player','Read current desktop music metadata, catalog ID, cover and lyrics without navigating or changing playback. null means unknown. Use for player refresh.',{},{readOnlyHint:true,idempotentHint:true},snapshot);
  register('netease_show_player','Open the native NetEase music player card with current track, cover, lyrics, playback controls and a text box that sends a message to this Codex task. Does not change playback.',{},{readOnlyHint:true,idempotentHint:true},snapshot,{ui:{resourceUri:PLAYER_URI,visibility:['model','app']},'openai/outputTemplate':PLAYER_URI});
  register('netease_seek','Seek the current track to seconds and verify the position. Requires exact trackId from a fresh player read; changed tracks or unsupported progress refuse the write.',{trackId:z.string().regex(/^\d+$/),seconds:z.number().finite().min(0)},{idempotentHint:true},args=>player.seek(args.trackId,args.seconds));
  register('netease_set_volume','Set NetEase application volume from 0 to 100 and verify the client volume. Does not change Windows system volume.',{percent:z.number().finite().min(0).max(100)},{idempotentHint:true},args=>player.volume(args.percent));
  register('netease_get_status', 'Read the current visible song label, playback and heart state. null means unknown. trackKey hashes the visible title/artist, not a unique catalog ID; identical labels are indistinguishable.', {}, { readOnlyHint: true, idempotentHint: true }, () => controller.status());
  register('netease_search', 'Search the music catalog through the desktop client background API, with caches disabled. Returns exact song IDs, artist and album metadata plus a two-minute session token. No mouse, keyboard, focus or page navigation. Does not change playback.', {
    query: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(30).default(10),
  }, { readOnlyHint: true }, ({ query, limit }) => controller.search(query, limit));
  register('netease_play_result', 'Play an exact catalog ID from the latest search through the client background action. Requires its token and string index; rechecks metadata and verifies the actual playing catalog ID. Adds the selected song to the current queue; does not isolate later playback. Does not prove audible output. Never automatically retry an uncertain result.', {
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
  register('netease_rename_playlist', 'After explicit user authorization, rename one owned playlist by exact ID and expected full name. Requires NETEASE_ENABLE_PLAYLIST_RENAME=1. Refuses protected, system and collected playlists. Sends only the name update once, then verifies uncached name, exact member order, privacy, ownership and playback state. On uncertain outcome repeat the identical arguments only for read-only recovery; never restart to bypass uncertainty.', {
    playlistId: z.string().regex(/^[1-9]\d{0,19}$/), expectedName: z.string().min(1).max(500), newName: z.string().min(1).max(40).refine(s => s.trim() === s && !/[\u0000-\u001f\u007f]/.test(s)),
  }, {}, ({ playlistId, expectedName, newName }) => catalogController().rename(playlistId, expectedName, newName));
  const catalogController = () => { if (!catalog) throw new Error('CATALOG_UNAVAILABLE'); return catalog; };
  register('netease_get_queue', 'Read the actual desktop playback queue in display order, with current song ID, playing state, mode and volume. Validates complete queue identities before returning a bounded slice. No playback or input changes.', {
    offset: z.number().int().min(0).max(10000).default(0), limit: z.number().int().min(1).max(1000).default(100),
  }, { readOnlyHint: true, idempotentHint: true }, ({ offset, limit }) => catalogController().queue(offset, limit));
  register('netease_play_playlist', 'After user authorization, replace the current queue with exactly this playlist in its current order and start its first song in sequential mode. Preserves volume and playlist membership. Requires exact playlist ID and full name, 1-200 tracks, ordinary music mode and no listen-together session. Verifies complete actual queue IDs and order, first playing ID, mode and unchanged volume. No mouse, keyboard or focus. On any uncertain outcome read netease_get_queue; never automatically restart or replay.', {
    playlistId: z.string().regex(/^[1-9]\d{0,19}$/), expectedName: z.string().min(1).max(500),
  }, { destructiveHint: true }, ({ playlistId, expectedName }) => catalogController().playPlaylist(playlistId, expectedName));
  register('netease_get_playlist_tracks', 'Read exact playlist member IDs from an uncached client API response. Verifies the full member count before returning a bounded slice. Does not navigate or alter playback.', {
    playlistId: z.string().regex(/^[1-9]\d{0,19}$/), offset: z.number().int().min(0).max(100000).default(0), limit: z.number().int().min(1).max(1000).default(100),
  }, { readOnlyHint: true, idempotentHint: true }, ({ playlistId, offset, limit }) => catalogController().tracks(playlistId, offset, limit));
  register('netease_add_tracks_to_playlist', 'After explicit user authorization, add exact catalog song IDs to an owned playlist matching its full name. Requires NETEASE_ENABLE_PLAYLIST_ADD=1. Refuses system, collected and protected playlists. Skips existing songs, dispatches at most once and verifies exact members with uncached readback. On uncertain outcomes only reads follow; do not blindly retry or restart to bypass uncertainty. Does not change playback or volume.', {
    playlistId: z.string().regex(/^[1-9]\d{0,19}$/), expectedName: z.string().min(1).max(500), trackIds: z.array(z.string().regex(/^[1-9]\d{0,19}$/)).min(1).max(50),
  }, {}, ({ playlistId, expectedName, trackIds }) => catalogController().add(playlistId, expectedName, trackIds));
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
  const music=new MusicController(adapter);
  const server = createServer(music, {
    catalog: new CatalogController(adapter, { addEnabled: process.env.NETEASE_ENABLE_PLAYLIST_ADD === '1', renameEnabled: process.env.NETEASE_ENABLE_PLAYLIST_RENAME === '1', protectedIds: (process.env.NETEASE_PROTECTED_PLAYLIST_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean) }),
    player:new PlayerController(adapter,music),
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

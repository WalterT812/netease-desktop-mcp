#!/usr/bin/env node
import { DesktopAdapter } from './adapter.mjs';
import { MusicController } from './controller.mjs';

const [command, ...args] = process.argv.slice(2);
const help = `NetEase Desktop MCP (experimental Windows adapter)
Set NETEASE_MUSIC_PATH and optionally NETEASE_MCP_PORT (default 9229).

node src/cli.mjs status
node src/cli.mjs search "query"
node src/cli.mjs play "query" "1"     Search again and play that row in one session
node src/cli.mjs playback play|pause
node src/cli.mjs skip next|previous
node src/cli.mjs like true|false <trackKey-from-status>

No command automatically starts or restarts the music client.
Search tokens are session-local; CLI play performs a fresh search.
Like writes require an explicit user request and a fresh matching trackKey.`;
if (!command || command === '--help' || command === 'help') {
  console.log(help);
} else {
  const adapter = new DesktopAdapter();
  const controller = new MusicController(adapter);
  try {
    await adapter.beginOperation();
    let result;
    switch (command) {
      case 'status': result = await controller.status(); break;
      case 'search': result = await controller.search(args[0]); break;
      case 'play': {
        if (!args[1]) throw new Error('Specify a query and explicit result index.');
        const search = await controller.search(args[0], 30);
        result = await controller.playResult(search.searchToken, args[1]);
        break;
      }
      case 'playback': result = await controller.setPlayback(args[0]); break;
      case 'skip': result = await controller.skip(args[0]); break;
      case 'like': {
        if (!['true', 'false'].includes(args[0])) throw new Error('liked must be true or false');
        result = await controller.setLiked(args[0] === 'true', args[1]);
        break;
      }
      default: throw new Error(help);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exitCode = 1;
  } finally { await adapter.disconnect(); }
}

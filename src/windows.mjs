import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

export function parseInspection(result) {
  if (!result.processId || !result.expectedPath || !result.actualPath || result.expectedPath.toLowerCase() !== result.actualPath.toLowerCase()) throw new Error('WRONG_PROCESS');
  if (!Array.isArray(result.addresses) || !result.addresses.length || result.addresses.some(a => a !== '127.0.0.1')) throw new Error('NON_LOOPBACK_LISTENER');
  return result;
}
export async function inspectWindows(executable, port) {
  if (process.platform !== 'win32') throw new Error('WINDOWS_REQUIRED: Live desktop control supports Windows only.');
  if (!executable) throw new Error('CONFIG_REQUIRED: Set NETEASE_MUSIC_PATH to cloudmusic.exe.');
  const script = fileURLToPath(new URL('../scripts/Inspect-CloudMusic.ps1', import.meta.url));
  try {
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script, '-CloudMusicPath', executable, '-Port', String(port)], { windowsHide: true, timeout: 10000, maxBuffer: 32768 });
    return parseInspection(JSON.parse(stdout.replace(/^\uFEFF/, '')));
  } catch (error) {
    if (['WRONG_PROCESS', 'NON_LOOPBACK_LISTENER'].includes(error.message)) throw error;
    throw new Error('CLIENT_NOT_READY: Check the configured executable and start CloudMusic with the loopback debug port. The MCP will not restart it.');
  }
}

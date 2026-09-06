import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { ControllerLease } from '../src/lease.mjs';

test('controller lease excludes a second owner and releases on close', async () => {
  await mkdir('.netease-mcp', { recursive: true });
  const suffix = randomUUID();
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\netease-mcp-test-${suffix}` : join(process.cwd(), '.netease-mcp', `${suffix}.sock`);
  const first = new ControllerLease(endpoint);
  const second = new ControllerLease(endpoint);
  try {
    await first.acquire();
    await assert.rejects(second.acquire(), /CONTROLLER_BUSY/);
    await first.release();
    await second.acquire();
  } finally { await first.release(); await second.release(); }
});

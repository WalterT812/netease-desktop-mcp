import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('CloudMusic launcher gives the player its own working directory', { skip: process.platform !== 'win32' }, () => {
  const sandbox = mkdtempSync(join(repo, 'test', '.cloudmusic-cwd-'));
  try {
    const caller = join(sandbox, 'workbench-app');
    const player = join(sandbox, 'player');
    const output = join(sandbox, 'cwd.txt');
    mkdirSync(caller);
    mkdirSync(player);
    writeFileSync(join(player, 'cloudmusic.exe'), 'probe only');

    const probe = `
function Get-NetTCPConnection { }
function Get-Process { }
function Start-Process {
    param($FilePath, $ArgumentList, $WindowStyle, $WorkingDirectory)
    Microsoft.PowerShell.Management\\Start-Process -FilePath $env:COMSPEC -ArgumentList '/d','/c','cd' -WorkingDirectory $WorkingDirectory -RedirectStandardOutput $env:PAW_PROBE_OUTPUT -Wait
    throw 'probe-complete'
}
try { & $env:PAW_PROBE_SCRIPT -CloudMusicPath $env:PAW_PROBE_PLAYER -Port 62317 }
catch { if ($_.Exception.Message -ne 'probe-complete') { throw } }
exit 0
`;
    execFileSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', probe], {
      cwd: caller,
      env: {
        ...process.env,
        PAW_PROBE_SCRIPT: join(repo, 'scripts', 'Start-CloudMusic.ps1'),
        PAW_PROBE_PLAYER: join(player, 'cloudmusic.exe'),
        PAW_PROBE_OUTPUT: output,
      },
      timeout: 10_000,
    });
    assert.equal(resolve(readFileSync(output, 'utf8').trim()).toLowerCase(), resolve(player).toLowerCase());
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

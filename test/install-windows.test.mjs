import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Exercise real file copies in a temporary app home; every Scheduler command is forbidden.
test('Windows installer only copies files, preserves config, and never creates startup machinery', { skip: process.platform !== 'win32' }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "herdr-installer's test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'mods/discord-rpc');
  const scripts = path.join(root, 'scripts');
  await fs.mkdir(source, { recursive: true });
  await fs.mkdir(scripts);
  await fs.copyFile(fileURLToPath(new URL('../scripts/install-windows.ps1', import.meta.url)), path.join(scripts, 'install-windows.ps1'));
  await fs.writeFile(path.join(source, 'main.js'), '// fixture host');
  await fs.writeFile(path.join(source, 'bridge.mjs'), '// fixture bridge');
  await fs.writeFile(path.join(source, 'config.example.json'), '{"enabled":true}');
  await fs.writeFile(path.join(source, 'config.json'), 'must not copy');
  await fs.writeFile(path.join(source, '.presence.json'), 'must not copy');
  const harness = path.join(root, 'check.ps1');
  await fs.writeFile(harness, String.raw`
$ErrorActionPreference = 'Stop'
foreach ($command in @('Get-ScheduledTask', 'Stop-ScheduledTask', 'New-ScheduledTaskAction', 'New-ScheduledTaskTrigger', 'New-ScheduledTaskPrincipal', 'New-ScheduledTaskSettingsSet', 'Register-ScheduledTask', 'Unregister-ScheduledTask', 'Start-ScheduledTask')) {
    Set-Item -Path "Function:global:$command" -Value { throw 'Installer must not invoke Task Scheduler' }
}
function Require($Condition, $Message) { if (-not $Condition) { throw $Message } }
$appHome = Join-Path $PSScriptRoot 'app home'
$installer = Join-Path $PSScriptRoot 'scripts/install-windows.ps1'
$env:HERDR_APP_HOME = $appHome
& $installer
$directory = Join-Path $appHome 'mods/discord-rpc'
$config = Join-Path $directory 'config.json'
Require ((Get-Content -Raw -LiteralPath $config) -eq '{"enabled":true}') 'Missing config did not use example'
Require ((Get-Content -Raw -LiteralPath (Join-Path $directory 'main.js')) -eq '// fixture host') 'Host was not copied'
Require ((Get-Content -Raw -LiteralPath (Join-Path $directory 'bridge.mjs')) -eq '// fixture bridge') 'Bridge was not copied'
Require (-not (Test-Path -LiteralPath (Join-Path $directory '.presence.json'))) 'Copied source runtime state'
Set-Content -LiteralPath $config -Value '{"enabled":false,"custom":"preserve"}' -NoNewline
Set-Content -LiteralPath (Join-Path $directory 'user-file.txt') -Value 'preserve'
Set-Content -LiteralPath (Join-Path $PSScriptRoot 'mods/discord-rpc/main.js') -Value '// updated host' -NoNewline
& $installer -AppHome $appHome
Require ((Get-Content -Raw -LiteralPath $config) -eq '{"enabled":false,"custom":"preserve"}') 'Reinstall overwrote config'
Require ((Get-Content -Raw -LiteralPath (Join-Path $directory 'main.js')) -eq '// updated host') 'Reinstall did not update host'
Require (Test-Path -LiteralPath (Join-Path $directory 'user-file.txt')) 'Reinstall removed unknown file'
$runtime = Join-Path $appHome 'data/discord-rpc'
Require (Test-Path -LiteralPath $runtime -PathType Container) 'Runtime directory is missing'
Require (@(Get-ChildItem -LiteralPath $runtime -Force).Count -eq 0) 'Installer created startup machinery or runtime state'
'PASS'
`);
  const output = execFileSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harness], { encoding: 'utf8', timeout: 30000 });
  assert.match(output, /PASS/);
  assert.match(output, /presenceHost/);
  assert.match(output, /No login task/);
});

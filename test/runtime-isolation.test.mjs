import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { Bridge } from '../mods/discord-rpc/bridge.mjs';
import { buildActivity, parseConfig } from '../mods/discord-rpc/presence.js';

// Exercise both producers against one app home, including their atomic temporary files.
test('heartbeat, close, bridge status and temporary writes stay outside watched mods', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'rpc-isolation-'));
  const directory = path.join(home, 'mods/discord-rpc');
  const data = path.join(home, 'data/discord-rpc');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify({ clientId: '123456789012345678', enabled: false }));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const outputs = [];
  const rename = fs.rename.bind(fs);
  t.mock.method(fs, 'rename', async (from, to) => {
    outputs.push(from, to);
    return rename(from, to);
  });
  const source = (await fs.readFile(new URL('../mods/discord-rpc/main.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace('export default class', 'class') + '\nDiscordRpc;';
  const tasks = [];
  const Class = vm.runInNewContext(source, {
    View: class {}, console, appHome: () => home,
    agents: () => [], spaces: () => [], terminals: () => [], panes: () => [], focused: () => null, props: () => null,
    buildActivity, parseConfig,
    readTextFile: async file => fs.readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; }),
    writeTextFile: async (file, text) => {
      outputs.push(file);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporary = path.join(path.dirname(file), '.herdr-app-write-test');
      await fs.writeFile(temporary, text);
      await fs.rename(temporary, file);
    },
    exec: async (_command, args) => {
      assert.equal(path.resolve(args[0]), path.join(directory, 'bridge.mjs'));
      assert.equal(args[1], '--start');
      assert.equal(path.resolve(args[2]), directory);
      return { code: 0 };
    },
  });
  const mod = new Class();
  const cx = { timer: { every() {} }, spawn(body) { tasks.push(body(cx)); } };
  mod.init({}, cx);
  await Promise.all(tasks);
  mod.lastWrite = 0;
  mod.flush(cx);
  await Promise.all(tasks);
  await mod.close();
  const snapshot = JSON.parse(await fs.readFile(path.join(data, '.presence.json'), 'utf8'));
  assert.equal(snapshot.activity, null);
  const bridge = new Bridge(directory);
  await bridge.tick();
  assert.equal(bridge.state, 'paused');
  assert.equal(JSON.parse(await fs.readFile(path.join(data, '.status.json'), 'utf8')).state, 'paused');
  await fs.writeFile(path.join(data, '.presence.json'), JSON.stringify({ ...snapshot, updatedAt: 1 }));
  await bridge.tick();
  await bridge.done;
  assert.equal(bridge.state, 'stale');
  assert.ok(outputs.some(file => path.basename(file).startsWith('.status-')));
  assert.ok(outputs.some(file => path.basename(file).startsWith('.herdr-app-write-')));
  assert.equal(outputs.every(file => path.resolve(path.dirname(file)) === data), true, JSON.stringify(outputs));
  assert.deepEqual(await fs.readdir(directory), ['config.json']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Bridge, DiscordConnection, FrameReader, frame } from '../mods/discord-rpc/bridge.mjs';

const CLIENT_ID = '123456789012345678';
const activity = (name = 'workspace · branch') => ({ name: 'Herdr', type: 0, details: name, state: 'Pi · 1/2 agents active', assets: { large_image: 'herdr', small_text: 'Pi' } });
const testSocket = (directory, name) => process.platform === 'win32'
  ? `\\\\.\\pipe\\herdr-rpc-test-${process.pid}-${path.basename(directory)}-${name}`
  : path.join(directory, `${name}.sock`);

async function waitFor(predicate, message = 'condition', timeout = 1500) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(5);
  }
  throw new Error(`Timed out waiting for ${message}`);
}

async function fixture(t, options = {}, handleCommand) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rpc-test-'));
  const directory = path.join(root, 'mods/discord-rpc');
  const runtimeDirectory = path.join(root, 'data/discord-rpc');
  await fs.mkdir(directory, { recursive: true });
  await fs.mkdir(runtimeDirectory, { recursive: true });
  const socketPath = testSocket(root, 'discord');
  const sockets = new Set();
  const commands = [];
  const handshakes = [];
  const pongs = [];
  const config = async (value) => {
    const temporary = path.join(directory, '.config-next.json');
    await fs.writeFile(temporary, JSON.stringify(value));
    await fs.rename(temporary, path.join(directory, 'config.json'));
  };
  const snapshot = async (value, updatedAt = Date.now()) => {
    const temporary = path.join(runtimeDirectory, '.presence-next.json');
    await fs.writeFile(temporary, JSON.stringify({ version: 1, updatedAt, activity: value }));
    await fs.rename(temporary, path.join(runtimeDirectory, '.presence.json'));
  };
  const status = async () => {
    try { return JSON.parse(await fs.readFile(path.join(runtimeDirectory, '.status.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  };
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    const reader = new FrameReader();
    socket.on('data', (chunk) => {
      for (const packet of reader.push(chunk)) {
        const payload = JSON.parse(packet.body.toString());
        if (packet.opcode === 0) {
          handshakes.push(payload);
          const ready = frame(1, { cmd: 'DISPATCH', evt: 'READY', data: { user: { username: 'must-not-be-recorded' } } });
          socket.write(ready.subarray(0, 5));
          setTimeout(() => {
            if (socket.destroyed) return;
            socket.write(Buffer.concat([ready.subarray(5), frame(3, { check: 'pong' })]));
          }, 2);
        } else if (packet.opcode === 4) {
          pongs.push(payload);
        } else {
          commands.push({ ...payload, receivedAt: Date.now() });
          if (handleCommand?.(payload, socket, commands) === false) continue;
          socket.write(frame(1, { cmd: 'SET_ACTIVITY', nonce: payload.nonce, data: payload.args.activity }));
        }
      }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  await config({ clientId: CLIENT_ID });
  await snapshot(activity());
  const bridge = new Bridge(directory, { paths: [socketPath], pollMs: 10, reconnectMs: 30, publishMs: 60, staleMs: 1500, futureMs: 50, timeoutMs: 120, ...options }).start();
  t.after(async () => {
    await bridge.stop();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { directory, runtimeDirectory, bridge, commands, handshakes, pongs, sockets, config, snapshot, status, socketPath };
}

test('collector failures clear acknowledged activity and surface the state error', async t => {
  const f = await fixture(t);
  await waitFor(() => f.bridge.state === 'published');
  await fs.writeFile(path.join(f.runtimeDirectory, '.presence.json'), JSON.stringify({
    version: 1, updatedAt: Date.now(), activity: null, error: 'Herdr app is not running',
  }));
  await waitFor(async () => (await f.status()).state === 'error' && f.bridge.activity === null && f.commands.some(command => command.args.activity === null));
  assert.match((await f.status()).error, /Herdr state unavailable: Herdr app is not running/);
  assert.equal(f.bridge.activity, null);
});

test('framing handles split headers/bodies, combined frames, and oversized input', () => {
  const first = frame(1, { evt: 'READY' });
  assert.equal(first.readUInt32LE(0), 1);
  assert.equal(first.readUInt32LE(4), Buffer.byteLength('{"evt":"READY"}'));
  const reader = new FrameReader();
  assert.deepEqual(reader.push(first.subarray(0, 3)), []);
  assert.deepEqual(reader.push(first.subarray(3, 10)), []);
  const packets = reader.push(Buffer.concat([first.subarray(10), frame(3, { n: 1 })]));
  assert.deepEqual(packets.map(({ opcode, body }) => [opcode, JSON.parse(body.toString())]), [[1, { evt: 'READY' }], [3, { n: 1 }]]);
  const oversized = Buffer.alloc(8);
  oversized.writeUInt32LE(1024 * 1024 + 1, 4);
  assert.throws(() => reader.push(oversized), /exceeds 1 MiB/);
});

test('handshakes, responds to PING, publishes only after ACK, and keeps READY profile out of status', async (t) => {
  let acknowledgment;
  // This test holds the ACK across filesystem assertions; allow Windows scheduling headroom.
  const f = await fixture(t, { timeoutMs: 1000 }, (payload, socket) => {
    if (payload.args.activity === null) return;
    acknowledgment = () => socket.write(frame(1, { cmd: 'SET_ACTIVITY', nonce: payload.nonce, data: payload.args.activity }));
    return false;
  });
  await waitFor(() => acknowledgment, 'publish request');
  assert.deepEqual(f.handshakes, [{ v: 1, client_id: CLIENT_ID }]);
  assert.equal(f.commands[0].args.pid, process.pid);
  assert.equal(f.commands[0].args.activity.name, 'Herdr');
  assert.equal(typeof f.commands[0].nonce, 'string');
  assert.notEqual((await f.status()).state, 'published');
  acknowledgment();
  await waitFor(async () => (await f.status()).state === 'published', 'published ACK');
  await waitFor(() => f.pongs.length, 'PONG');
  assert.deepEqual(f.pongs[0], { check: 'pong' });
  const status = await f.status();
  assert.deepEqual(status.activity, activity());
  assert.ok(status.lastAckAt);
  assert.equal(JSON.stringify(status).includes('must-not-be-recorded'), false);
});

test('pause clears immediately despite publish throttle and never repeats an acknowledged clear', async (t) => {
  const f = await fixture(t, { publishMs: 10000 });
  await waitFor(async () => (await f.status()).state === 'published');
  await f.config({ clientId: CLIENT_ID, enabled: false });
  await waitFor(async () => (await f.status()).state === 'paused' && (await f.status()).activity === null, 'paused clear');
  assert.equal(f.commands.length, 2);
  assert.equal(f.commands[1].args.activity, null);
  await delay(50);
  assert.equal(f.commands.length, 2);
});

test('updates coalesce to the newest snapshot and unchanged activity does not republish', async (t) => {
  const f = await fixture(t, { publishMs: 300 });
  await waitFor(async () => (await f.status()).state === 'published');
  await f.snapshot(activity('intermediate'));
  await delay(35);
  await f.snapshot(activity('latest'));
  await waitFor(() => f.commands.length >= 2, 'coalesced update');
  assert.ok(f.commands[1].args.activity, JSON.stringify({ commands: f.commands, status: await f.status() }));
  assert.equal(f.commands[1].args.activity.details, 'latest');
  assert.ok(f.commands[1].receivedAt - f.commands[0].receivedAt >= 290);
  await delay(40);
  assert.equal(f.commands.length, 2);
});

test('forwards status display selection through SET_ACTIVITY and rejects invalid enums', async (t) => {
  const f = await fixture(t);
  await waitFor(async () => (await f.status()).state === 'published');
  for (const status_display_type of [0, 1, 2]) {
    await f.snapshot({ ...activity(), status_display_type });
    await waitFor(async () => (await f.status()).activity?.status_display_type === status_display_type, 'display selection ACK');
    assert.equal(f.commands.at(-1).args.activity.status_display_type, status_display_type);
  }
  for (const status_display_type of [3, '1', null]) {
    await f.snapshot({ ...activity(), status_display_type });
    await waitFor(async () => (await f.status()).state === 'error' && (await f.status()).activity === null, 'invalid display type clear');
    assert.match((await f.status()).error, /Invalid activity status_display_type/);
    await f.snapshot({ ...activity(), status_display_type: 2 });
    await waitFor(async () => (await f.status()).state === 'published' && (await f.status()).activity?.status_display_type === 2, 'valid display type recovery');
  }
});

test('text limits count Unicode codepoints, including emoji labels', async (t) => {
  const f = await fixture(t, { publishMs: 10 });
  await waitFor(async () => (await f.status()).state === 'published');
  const label = '😀'.repeat(128);
  await f.snapshot(activity(label));
  await waitFor(async () => (await f.status()).state === 'published' && (await f.status()).activity?.details === label, 'emoji activity');
  assert.equal(f.commands.at(-1).args.activity.details, label);
  await f.snapshot(activity(label + '😀'));
  await waitFor(async () => (await f.status()).state === 'error' && (await f.status()).activity === null, 'overlong emoji clear');
  assert.match((await f.status()).error, /Invalid activity details/);
});

test('invalid activity names fail closed instead of bypassing field validation', async (t) => {
  const f = await fixture(t);
  await waitFor(async () => (await f.status()).state === 'published');
  await f.snapshot({ ...activity(), name: 42 });
  await waitFor(async () => (await f.status()).state === 'error' && (await f.status()).activity === null, 'invalid name clear');
  assert.equal(f.commands.at(-1).args.activity, null);
  assert.match((await f.status()).error, /Invalid activity name/);
});

test('malformed snapshot fails closed, clears, and leaves a useful error', async (t) => {
  const f = await fixture(t, { publishMs: 10 });
  await waitFor(async () => (await f.status()).state === 'published');
  await fs.writeFile(path.join(f.runtimeDirectory, '.presence.json'), '{');
  await waitFor(async () => (await f.status()).state === 'error' && (await f.status()).activity === null, 'invalid snapshot clear');
  assert.equal(f.commands.at(-1).args.activity, null);
  assert.match((await f.status()).error, /Invalid \.presence.json/);
  await delay(30);
  assert.equal(f.commands.length, 2);
});

test('invalid config clears an existing activity rather than continuing with the old config', async (t) => {
  const f = await fixture(t);
  await waitFor(async () => (await f.status()).state === 'published');
  await f.config({ clientId: 'not-an-id' });
  await waitFor(async () => (await f.status()).state === 'error' && (await f.status()).activity === null, 'invalid config clear');
  assert.equal(f.commands.at(-1).args.activity, null);
  assert.match((await f.status()).error, /clientId/);
});

test('Discord RPC errors never produce a published status and reconnect is bounded', async (t) => {
  const f = await fixture(t, { publishMs: 180, reconnectMs: 70 }, (payload, socket, commands) => {
    if (commands.length !== 1) return;
    socket.write(frame(1, { cmd: 'SET_ACTIVITY', nonce: payload.nonce, evt: 'ERROR', data: { code: 4000, message: 'invalid activity' } }));
    return false;
  });
  await waitFor(async () => /invalid activity/.test((await f.status()).error ?? ''), 'RPC error');
  const failed = await f.status();
  assert.notEqual(failed.state, 'published');
  assert.equal(failed.activity, null);
  assert.equal(failed.lastAckAt, null);
  await waitFor(async () => (await f.status()).state === 'published', 'reconnect and publish');
  assert.ok(f.handshakes.length >= 2);
  assert.ok(f.commands[1].receivedAt - f.commands[0].receivedAt >= 170);
});

test('disconnect invalidates acknowledged status, reconnects, and stop clears presence', async (t) => {
  const f = await fixture(t, { reconnectMs: 80, publishMs: 20 });
  await waitFor(async () => (await f.status()).state === 'published');
  for (const socket of f.sockets) socket.destroy();
  await waitFor(async () => (await f.status()).state === 'disconnected', 'disconnected status');
  assert.equal((await f.status()).activity, null);
  await waitFor(async () => (await f.status()).state === 'published', 'reconnected publish');
  await f.bridge.stop();
  assert.equal(f.commands.at(-1).args.activity, null);
  assert.equal((await f.status()).state, 'stopped');
  assert.equal((await f.status()).activity, null);
});

test('stop during the first asynchronous tick cannot restart or overwrite stopped status', async (t) => {
  const f = await fixture(t);
  await f.bridge.stop();
  await delay(40);
  assert.equal((await f.status()).state, 'stopped');
  assert.equal(f.commands.length, 0);
});

test('expired heartbeat clears and exits', async (t) => {
  const f = await fixture(t, { staleMs: 100 });
  await waitFor(async () => (await f.status()).state === 'published');
  await f.bridge.done;
  assert.equal(f.commands.at(-1).args.activity, null);
  assert.equal((await f.status()).state, 'stale');
  assert.match((await f.status()).error, /expired/);
});

test('future heartbeat clears and exits', async (t) => {
  const f = await fixture(t);
  await waitFor(async () => (await f.status()).state === 'published');
  await f.snapshot(activity(), Date.now() + 10000);
  await f.bridge.done;
  assert.equal(f.commands.at(-1).args.activity, null);
  assert.equal((await f.status()).state, 'stale');
  assert.match((await f.status()).error, /future/);
});

test('--start returns promptly and duplicate launches retain one helper', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rpc-singleton-'));
  const directory = path.join(root, 'mods/discord-rpc');
  const runtimeDirectory = path.join(root, 'data/discord-rpc');
  await fs.mkdir(directory, { recursive: true });
  await fs.mkdir(runtimeDirectory, { recursive: true });
  let pid;
  t.after(async () => {
    if (pid) {
      await fs.writeFile(path.join(runtimeDirectory, '.presence.json'), JSON.stringify({ version: 1, updatedAt: 1, activity: null }));
      try {
        await waitFor(async () => {
          try { return JSON.parse(await fs.readFile(path.join(runtimeDirectory, '.status.json'), 'utf8')).state === 'stale'; }
          catch { return false; }
        }, 'helper lease cleanup', 3000);
      } catch (error) {
        try { process.kill(pid, 'SIGTERM'); } catch {}
        throw error;
      }
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify({ clientId: CLIENT_ID, enabled: false }));
  await fs.writeFile(path.join(runtimeDirectory, '.presence.json'), JSON.stringify({ version: 1, updatedAt: Date.now(), activity: null }));
  const executable = fileURLToPath(new URL('../mods/discord-rpc/bridge.mjs', import.meta.url));
  const launch = () => promisify(execFile)(process.execPath, [executable, '--start', directory], { timeout: 6000 });
  await launch();
  await waitFor(async () => {
    try { const status = JSON.parse(await fs.readFile(path.join(runtimeDirectory, '.status.json'), 'utf8')); pid = status.pid; return status.state === 'paused'; }
    catch { return false; }
  }, 'singleton status', 3000);
  await Promise.all(Array.from({ length: 5 }, launch));
  const status = JSON.parse(await fs.readFile(path.join(runtimeDirectory, '.status.json'), 'utf8'));
  assert.equal(status.pid, pid);
  assert.equal(status.state, 'paused');
  assert.notEqual(pid, process.pid);
});

test('missing ACK and missing READY have finite timeouts', async (t) => {
  const f = await fixture(t, { timeoutMs: 35, reconnectMs: 200 }, () => false);
  await waitFor(async () => /acknowledgment timeout/.test((await f.status()).error ?? ''), 'ACK timeout');
  assert.notEqual((await f.status()).state, 'published');
  assert.equal((await f.status()).activity, null);

  const socketPath = testSocket(f.directory, 'silent');
  const sockets = new Set();
  const silent = net.createServer((socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise((resolve) => silent.listen(socketPath, resolve));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => silent.close(resolve)); });
  const connection = new DiscordConnection(socketPath, CLIENT_ID, 30);
  await assert.rejects(connection.open(), /READY timeout/);
});

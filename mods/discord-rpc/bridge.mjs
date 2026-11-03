import net from 'node:net';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const MAX_FRAME = 1024 * 1024;

export function frame(opcode, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload));
  const header = Buffer.alloc(8);
  header.writeUInt32LE(opcode, 0);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

export class FrameReader {
  buffer = Buffer.alloc(0);

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames = [];
    while (this.buffer.length >= 8) {
      const length = this.buffer.readUInt32LE(4);
      if (length > MAX_FRAME) throw new Error('Discord IPC frame exceeds 1 MiB');
      if (this.buffer.length < 8 + length) break;
      frames.push({ opcode: this.buffer.readUInt32LE(0), body: this.buffer.subarray(8, 8 + length) });
      this.buffer = this.buffer.subarray(8 + length);
    }
    return frames;
  }
}

export class DiscordConnection extends EventEmitter {
  constructor(socketPath, clientId, timeoutMs = 5000) {
    super();
    this.socketPath = socketPath;
    this.clientId = clientId;
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.reader = new FrameReader();
    this.closed = false;
  }

  open() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('Discord connection/READY timeout')), this.timeoutMs);
      this.ready = (error) => {
        clearTimeout(timer);
        this.ready = null;
        if (error) reject(error);
        else resolve(this);
      };
      this.socket = net.createConnection(this.socketPath);
      this.socket.once('connect', () => this.socket.write(frame(0, { v: 1, client_id: this.clientId })));
      this.socket.on('data', (chunk) => {
        try {
          for (const packet of this.reader.push(chunk)) this.receive(packet);
        } catch (error) {
          this.fail(error);
        }
      });
      this.socket.on('error', (error) => this.fail(error));
      this.socket.once('close', () => this.fail(new Error('Discord IPC disconnected')));
    });
  }

  receive({ opcode, body }) {
    if (opcode === 3) {
      this.socket.write(frame(4, body));
      return;
    }
    if (opcode === 4) return;
    if (opcode === 2) throw new Error(`Discord closed IPC: ${body.toString().slice(0, 200)}`);
    if (opcode !== 1) throw new Error(`Unexpected Discord IPC opcode ${opcode}`);
    const message = JSON.parse(body.toString('utf8'));
    if (message.evt === 'READY' && this.ready) {
      this.ready();
      return;
    }
    const request = this.pending.get(message.nonce);
    if (message.evt === 'ERROR') {
      const error = new Error(`Discord RPC ${message.data?.code ?? 'error'}: ${message.data?.message ?? 'request rejected'}`);
      if (!request) throw error;
      this.pending.delete(message.nonce);
      clearTimeout(request.timer);
      request.reject(error);
    } else if (request) {
      this.pending.delete(message.nonce);
      clearTimeout(request.timer);
      if (message.cmd !== 'SET_ACTIVITY') request.reject(new Error('Unexpected Discord RPC acknowledgment'));
      else request.resolve();
    }
  }

  setActivity(activity) {
    if (this.closed || this.ready) return Promise.reject(new Error('Discord IPC is not ready'));
    const nonce = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('Discord SET_ACTIVITY acknowledgment timeout')), this.timeoutMs);
      this.pending.set(nonce, { resolve, reject, timer });
      this.socket.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce }));
    });
  }

  fail(error) {
    if (this.closed) return;
    this.closed = true;
    if (this.ready) this.ready(error);
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    this.socket?.destroy();
    this.emit('disconnected', error);
  }

  close() {
    this.fail(new Error('Discord IPC connection closed'));
  }
}

function validateActivity(activity) {
  if (activity === null) return null;
  if (!activity || activity.type !== 0) throw new Error('Snapshot activity must be null or Playing (type 0)');
  const result = { type: 0 };
  for (const key of ['name', 'details', 'state']) {
    if (activity[key] !== undefined) {
      if (typeof activity[key] !== 'string' || !activity[key] || Array.from(activity[key]).length > 128) {
        throw new Error(`Invalid activity ${key}`);
      }
      result[key] = activity[key];
    }
  }
  if (activity.status_display_type !== undefined) {
    if (![0, 1, 2].includes(activity.status_display_type)) throw new Error('Invalid activity status_display_type');
    result.status_display_type = activity.status_display_type;
  }
  if (activity.assets !== undefined) {
    result.assets = {};
    for (const key of ['large_image', 'large_text', 'small_image', 'small_text']) {
      const value = activity.assets[key];
      if (value !== undefined) {
        if (typeof value !== 'string' || !value || Array.from(value).length > 256) throw new Error(`Invalid activity asset ${key}`);
        result.assets[key] = value;
      }
    }
  }
  if (activity.timestamps !== undefined) {
    const start = activity.timestamps.start;
    if (!Number.isSafeInteger(start) || start < 0) throw new Error('Invalid activity start timestamp');
    result.timestamps = { start };
  }
  return result;
}

async function readJson(file) {
  const text = await fs.readFile(file, 'utf8');
  if (text.length > MAX_FRAME) throw new Error(`${path.basename(file)} exceeds 1 MiB`);
  return JSON.parse(text);
}

export class Bridge {
  constructor(directory, options = {}) {
    this.directory = directory;
    this.runtimeDirectory = path.resolve(directory, '../../data/discord-rpc');
    this.options = { pollMs: 1000, reconnectMs: 5000, publishMs: 15000, staleMs: 45000, futureMs: 5000, timeoutMs: 5000, ...options };
    this.paths = options.paths ?? Array.from({ length: 10 }, (_, n) => `\\\\.\\pipe\\discord-ipc-${n}`);
    this.state = 'starting';
    this.error = null;
    this.lastAckAt = null;
    this.activity = null;
    this.lastFreshAt = Date.now();
    this.startedAt = this.lastFreshAt;
    this.nextConnectAt = 0;
    this.nextPublishAt = 0;
    this.needsClear = false;
    this.statusWrites = Promise.resolve();
    this.done = new Promise((resolve) => { this.resolveDone = resolve; });
  }

  start() {
    this.timer = setInterval(() => this.tick(), this.options.pollMs);
    this.tick();
    return this;
  }

  async status() {
    const record = { state: this.state, pid: process.pid, lastAckAt: this.lastAckAt, activity: this.activity, error: this.error };
    const signature = JSON.stringify(record);
    if (signature === this.statusSignature) return this.statusWrites;
    this.statusSignature = signature;
    const text = JSON.stringify({ ...record, updatedAt: Date.now() }, null, 2) + '\n';
    this.statusWrites = this.statusWrites.catch(() => {}).then(async () => {
      await fs.mkdir(this.runtimeDirectory, { recursive: true });
      const temporary = path.join(this.runtimeDirectory, `.status-${process.pid}.tmp`);
      await fs.writeFile(temporary, text);
      for (let attempt = 0; ; attempt++) {
        try {
          await fs.rename(temporary, path.join(this.runtimeDirectory, '.status.json'));
          break;
        } catch (error) {
          // Windows readers can briefly hold a delete-sharing lock on the destination.
          if (attempt >= 4 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
          await delay(10 * (attempt + 1));
        }
      }
    });
    return this.statusWrites;
  }

  async tick() {
    if (this.ticking || this.stopping) return;
    this.ticking = true;
    try {
      let snapshot;
      let failure;
      try {
        snapshot = await readJson(path.join(this.runtimeDirectory, '.presence.json'));
        if (this.stopping) return;
        if (snapshot.version !== 1 || !Number.isSafeInteger(snapshot.updatedAt)) throw new Error('Invalid snapshot version/heartbeat');
        const age = Date.now() - snapshot.updatedAt;
        if (age > this.options.staleMs || age < -this.options.futureMs) {
          this.error = age < 0 ? 'Snapshot heartbeat is in the future' : 'Snapshot heartbeat expired';
          await this.stop('stale');
          return;
        }
        this.lastFreshAt = Date.now();
        snapshot.activity = validateActivity(snapshot.activity);
        if (typeof snapshot.error === 'string' && snapshot.error) failure = `Herdr state unavailable: ${snapshot.error.slice(0, 300)}`;
      } catch (error) {
        failure = `Invalid .presence.json: ${error.message}`;
        if (Date.now() - this.lastFreshAt > this.options.staleMs) {
          this.error = failure;
          await this.stop('stale');
          return;
        }
      }
      let config;
      try {
        config = await readJson(path.join(this.directory, 'config.json'));
        if (this.stopping) return;
        if (!/^\d{17,20}$/.test(config.clientId) || typeof config.clientId !== 'string') throw new Error('clientId must be a 17–20 digit string');
        if (config.enabled !== undefined && typeof config.enabled !== 'boolean') throw new Error('enabled must be a boolean');
      } catch (error) {
        failure = `Invalid config.json: ${error.message}`;
      }
      if (this.stopping) return;
      this.desired = failure || config.enabled === false ? null : snapshot.activity;
      if (this.desired !== null) this.desired.timestamps = { start: this.startedAt };
      this.desiredState = failure ? 'error' : config.enabled === false ? 'paused' : this.desired === null ? 'idle' : 'pending';
      this.desiredError = failure ?? null;
      this.error = failure ?? (this.connection ? null : this.error);
      if (!failure && this.clientId !== undefined && config.clientId !== this.clientId) this.disconnect();
      if (!failure && config.enabled !== false) {
        this.clientId = config.clientId;
        if (!this.connection && !this.connecting && Date.now() >= this.nextConnectAt) this.connect();
      }
      this.publish();
      if (this.desired === null) this.state = this.desiredState;
      else if (!this.connection) this.state = 'disconnected';
      else if (JSON.stringify(this.activity) === JSON.stringify(this.desired) && !this.pending) this.state = 'published';
      else this.state = 'pending';
      await this.status();
    } catch (error) {
      this.error = error.message;
      this.desired = null;
      this.desiredState = this.state = 'error';
      this.publish();
      await this.status().catch(() => {});
    } finally {
      this.ticking = false;
    }
  }

  connect() {
    const attempt = {};
    this.connecting = attempt;
    const clientId = this.clientId;
    (async () => {
      let failure;
      for (const socketPath of this.paths) {
        if (this.stopping || this.connecting !== attempt) return;
        const connection = new DiscordConnection(socketPath, clientId, this.options.timeoutMs);
        attempt.connection = connection;
        try {
          await connection.open();
          if (this.stopping || this.connecting !== attempt) { connection.close(); return; }
          this.connection = connection;
          this.connecting = null;
          this.error = null;
          connection.on('disconnected', (error) => {
            if (this.connection !== connection || this.stopping) return;
            this.connection = null;
            this.pending = null;
            this.needsClear = false;
            this.activity = null;
            this.state = 'disconnected';
            this.error = error.message;
            this.nextConnectAt = Date.now() + this.options.reconnectMs;
            this.status().catch(() => {});
          });
          this.publish();
          return;
        } catch (error) {
          failure = error;
        }
      }
      if (this.connecting !== attempt || this.stopping) return;
      this.connecting = null;
      this.nextConnectAt = Date.now() + this.options.reconnectMs;
      this.error = failure?.message ?? 'No Discord IPC endpoint';
      this.state = 'disconnected';
      await this.status();
    })().catch((error) => {
      this.connecting = null;
      this.error = error.message;
      this.status().catch(() => {});
    });
  }

  publish() {
    const connection = this.connection;
    if (!connection || this.stopping) return;
    const key = JSON.stringify(this.desired);
    if (this.desired === null) {
      if (!this.needsClear || this.pending?.key === 'null') return;
    } else {
      if (this.pending || JSON.stringify(this.activity) === key || Date.now() < this.nextPublishAt) return;
      this.nextPublishAt = Date.now() + this.options.publishMs;
      this.needsClear = true;
    }
    const operation = { key, activity: this.desired };
    this.pending = operation;
    this.state = this.desired === null ? this.desiredState : 'pending';
    connection.setActivity(operation.activity).then(() => {
      if (this.stopping || this.connection !== connection || this.pending !== operation) return;
      this.pending = null;
      this.lastAckAt = Date.now();
      this.activity = operation.activity;
      if (operation.activity === null) this.needsClear = false;
      this.error = this.desiredError;
      this.state = operation.activity === null ? this.desiredState : JSON.stringify(this.desired) === operation.key ? 'published' : 'pending';
      this.status().catch(() => {});
      this.publish();
    }).catch((error) => {
      if (this.stopping || this.connection !== connection || this.pending !== operation) return;
      this.pending = null;
      this.error = error.message;
      this.state = 'error';
      // A rejected clear must not leave a live connection claiming old presence.
      this.disconnect();
      this.error = error.message;
      this.state = 'error';
      this.status().catch(() => {});
    });
    this.status().catch(() => {});
  }

  disconnect() {
    this.connecting?.connection?.close();
    this.connecting = null;
    const connection = this.connection;
    this.connection = null;
    connection?.close();
    this.pending = null;
    this.needsClear = false;
    this.activity = null;
    this.nextConnectAt = Date.now() + this.options.reconnectMs;
  }

  async stop(state = 'stopped') {
    if (this.stopping) return this.done;
    this.stopping = true;
    clearInterval(this.timer);
    this.connecting?.connection?.close();
    this.connecting = null;
    const connection = this.connection;
    this.pending = null;
    if (connection && this.needsClear) {
      let timeout;
      try {
        await Promise.race([
          connection.setActivity(null),
          new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Clear acknowledgment timed out')), Math.min(1000, this.options.timeoutMs)); }),
        ]);
        this.lastAckAt = Date.now();
      } catch (error) {
        this.error = this.error ?? error.message;
      } finally {
        clearTimeout(timeout);
      }
    }
    this.connection = null;
    connection?.close();
    this.activity = null;
    this.state = state;
    await this.status().catch(() => {});
    this.resolveDone();
  }
}

function lockPath(directory) {
  const normalized = process.platform === 'win32' ? directory.toLowerCase() : directory;
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 24);
  return process.platform === 'win32' ? `\\\\.\\pipe\\herdr-app-discord-rpc-${hash}` : path.join(os.tmpdir(), `herdr-app-discord-rpc-${hash}.sock`);
}

async function lockExists(address) {
  return new Promise((resolve) => {
    const socket = net.createConnection(address);
    const finish = (exists) => { socket.destroy(); resolve(exists); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(500, () => finish(true));
  });
}

async function main() {
  const [mode, argument] = process.argv.slice(2);
  if (!['--start', '--daemon'].includes(mode) || !argument) throw new Error('Usage: node bridge.mjs --start <modDirectory>');
  const directory = await fs.realpath(path.resolve(argument));
  // Keep the old singleton identity so upgrades wait for the old heartbeat lease to expire.
  const address = lockPath(directory);
  if (mode === '--start') {
    if (await lockExists(address)) return;
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--daemon', directory], { detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      const timer = setTimeout(() => { child.kill(); reject(new Error('Discord helper startup timed out')); }, 5000);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => { clearTimeout(timer); if (code) reject(new Error(`Discord helper exited ${code}`)); });
      child.once('message', (message) => {
        clearTimeout(timer);
        if (child.connected) child.disconnect();
        child.unref();
        if (message.ready) resolve();
        else reject(new Error(message.error ?? 'Discord helper failed to start'));
      });
    });
    return;
  }
  if (process.platform !== 'win32' && !await lockExists(address)) await fs.unlink(address).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  const singleton = net.createServer((socket) => socket.destroy());
  try {
    await new Promise((resolve, reject) => { singleton.once('error', reject); singleton.listen(address, resolve); });
  } catch (error) {
    if (error.code === 'EADDRINUSE') { process.send?.({ ready: true }); process.disconnect?.(); return; }
    throw error;
  }
  const bridge = new Bridge(directory).start();
  process.send?.({ ready: true });
  process.disconnect?.();
  const stop = () => bridge.stop();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  await bridge.done;
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
  await new Promise((resolve) => singleton.close(resolve));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.send?.({ error: error.message });
    console.error(error.message);
    if (process.connected) process.disconnect();
    process.exitCode = 1;
  });
}

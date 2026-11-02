import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { buildActivity, parseConfig } from "../mods/discord-rpc/presence.js";

// The native GPUI modules aren't available in Node; substitute just their host APIs.
const source = (await readFile(new URL("../mods/discord-rpc/main.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/gm, "").replace("export default class", "class") + "\nDiscordRpc;";
function runtime(overrides = {}) {
  const config = JSON.stringify({ clientId: "123456789012345678", enabled: true });
  const writes = [];
  const tasks = [];
  const calls = [];
  let callback;
  const Class = vm.runInNewContext(source, {
    View: class {},
    div: () => ({ w() { return this; }, h() { return this; } }),
    console: { log() {} },
    appHome: () => "/app",
    agents: () => [], spaces: () => [], terminals: () => [], panes: () => [], focused: () => null, props: () => null,
    readTextFile: async path => path.endsWith("/config.json") ? config : null,
    writeTextFile: async (...args) => writes.push(args),
    exec: async (...args) => { calls.push(args); return { code: 0 }; },
    buildActivity, parseConfig,
    ...overrides,
  });
  const cx = { timer: { every(_ms, body) { callback = body; } }, spawn(body) { const task = body(cx); tasks.push(task); return task; } };
  return { mod: new Class(), cx, writes, tasks, calls, tick: () => callback(cx) };
}

test("mod coalesces concurrent flushes and writes a heartbeat outside mods", async () => {
  const r = runtime();
  r.mod.init({}, r.cx);
  r.mod.flush(r.cx);
  await Promise.all(r.tasks);
  assert.equal(r.writes.length, 1);
  assert.equal(r.writes[0][0], "/app/data/discord-rpc/.presence.json");
  const snapshot = JSON.parse(r.writes[0][1]);
  assert.equal(snapshot.version, 1);
  assert.ok(Date.now() - snapshot.updatedAt < 1000);
  assert.equal(snapshot.activity, null);
  assert.equal(r.calls[0][0], "node");
  assert.deepEqual(Array.from(r.calls[0][1]), ["/app/mods/discord-rpc/bridge.mjs", "--start", "/app/mods/discord-rpc"]);
  r.tick();
  assert.equal(r.tasks.length, 1);
});

test("live changes during an in-flight write are not lost", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const r = runtime({ writeTextFile: async () => gate });
  r.mod.init({}, r.cx);
  r.mod.render();
  release();
  await Promise.all(r.tasks);
  assert.notEqual(r.mod.writtenRevision, r.mod.revision);
  r.tick();
  await Promise.all(r.tasks);
  assert.equal(r.mod.writtenRevision, r.mod.revision);
});

test("invalid privacy configuration writes null rather than retaining old presence", async () => {
  const r = runtime({ readTextFile: async path => path.endsWith("/config.json") ? '{"clientId":"123456789012345678","privatePatterns":"broken"}' : null });
  r.mod.init({}, r.cx);
  await Promise.all(r.tasks);
  assert.equal(JSON.parse(r.writes[0][1]).activity, null);
});

test("opening and closing settings never starts or clears a second presence host", async () => {
  const calls = [];
  const r = runtime({
    props: () => ({ overlay: "settings" }),
    Settings: class {
      init(_props, _cx, branch) { calls.push("init"); assert.equal(typeof branch, "function"); }
      render() { calls.push("render"); return "settings"; }
    },
  });
  r.mod.init({}, r.cx);
  assert.equal(r.mod.render(), "settings");
  await r.mod.close();
  assert.deepEqual(calls, ["init", "render"]);
  assert.equal(r.writes.length, 0);
  assert.equal(r.calls.length, 0);
  assert.equal(r.tasks.length, 0);
});

test("the visible launcher opens settings without publishing or clearing presence", async () => {
  let click;
  const overlays = [], children = [];
  let button, icon, tooltip, accessibleName;
  button = new Proxy({}, { get(_target, key) {
    return (...args) => {
      if (key === "on_click") click = args[0];
      if (key === "child") children.push(args[0]);
      if (key === "tooltip") tooltip = args[0];
      if (key === "accessibility_label") accessibleName = args[0];
      return button;
    };
  } });
  const r = runtime({
    props: () => ({ launcher: true }),
    Button: { new: () => button },
    svg: path => { icon = path; return button; },
    theme: () => ({}),
    openOverlay: spec => overlays.push(JSON.parse(JSON.stringify(spec))),
  });
  r.mod.init({}, r.cx);
  assert.equal(r.mod.render(), button);
  assert.equal(icon, "mods/discord-rpc/discord.svg");
  assert.deepEqual(children, [button], "the launcher has an icon and no visible text");
  assert.equal(tooltip, "Discord presence");
  assert.equal(accessibleName, "Discord presence settings");
  click();
  assert.deepEqual(overlays, [{ mod: "discord-rpc", kind: "dialog", width: 560, height: 760 }]);
  await r.mod.close();
  assert.equal(r.writes.length, 0);
  assert.equal(r.calls.length, 0);
  assert.equal(r.tasks.length, 0);
});

test("close retries a stale snapshot caused by an already-started flush", async () => {
  let state = '{"activity":{"details":"old"}}';
  let attempts = 0;
  const r = runtime({
    readTextFile: async () => state,
    writeTextFile: async (path, next, expected) => {
      assert.equal(path, "/app/data/discord-rpc/.presence.json");
      attempts++;
      if (attempts === 1) {
        state = '{"activity":{"details":"in-flight"}}';
        throw new Error("stale snapshot");
      }
      assert.equal(expected, state);
      state = next;
    },
  });
  r.mod.runtimeDirectory = "/app/data/discord-rpc";
  await r.mod.close();
  assert.equal(attempts, 2);
  assert.equal(r.mod.closing, true);
  assert.equal(JSON.parse(state).activity, null);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { buildActivity, DEFAULT_DETAILS, parseConfig } from "../mods/discord-rpc/presence.js";

// The native GPUI modules aren't available in Node; substitute just their host APIs.
const source = (await readFile(new URL("../mods/discord-rpc/main.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/gm, "").replace("export default class", "class") + "\nDiscordRpc;";
function runtime(overrides = {}) {
  const config = JSON.stringify({ clientId: "123456789012345678", enabled: true });
  const writes = [], tasks = [], calls = [], timers = [];
  let now = Date.now();
  let element;
  element = new Proxy({}, { get: () => () => element });
  const Class = vm.runInNewContext(source, {
    View: class {}, div: () => element, svg: () => element,
    Button: { new: () => element }, theme: () => ({}),
    console: { log() {} }, appHome: () => "/app",
    Date: class extends Date { static now() { return now; } },
    agents: () => [], spaces: () => [], terminals: () => [], panes: () => [], focused: () => null,
    props: () => ({ presenceHost: true }),
    readTextFile: async path => path.endsWith("/config.json") ? config : null,
    writeTextFile: async (...args) => writes.push(args),
    exec: async (...args) => { calls.push(args); return { code: 0 }; },
    buildActivity, DEFAULT_DETAILS, parseConfig,
    ...overrides,
  });
  const cx = { notify() {}, timer: { every(...args) { timers.push(args); } }, spawn(body) { const task = body(cx); tasks.push(task); return task; } };
  return { mod: new Class(), cx, writes, tasks, calls, timers, empty: element,
    tick: () => timers[0][1](cx), advance: ms => { now += ms; } };
}

test("Details shuffle holds until its interval, avoids repeats, and resets on disable or edits", async () => {
  let config = { clientId: "123456789012345678", shuffleDetails: true, detailsTemplates: ["Alternative", "Alternative"] };
  const r = runtime({
    Math: { random: () => 0, floor: Math.floor },
    spaces: () => [{ id: "s", name: "Workspace", active: true }],
    readTextFile: async path => path.endsWith("/config.json") ? JSON.stringify(config) : null,
  });
  const flush = async ms => { r.advance(ms); r.tick(); await Promise.all(r.tasks); return JSON.parse(r.writes.at(-1)[1]).activity; };
  r.mod.init({}, r.cx);
  await Promise.all(r.tasks);
  assert.equal(JSON.parse(r.writes[0][1]).activity.details, "Workspace");
  assert.equal((await flush(179999)).details, "Workspace");
  assert.equal((await flush(10001)).details, "Alternative");
  assert.equal((await flush(180000)).details, "Workspace");
  config.detailsIntervalMinutes = 1;
  assert.equal((await flush(10000)).details, "Alternative", "interval edits reset the selection and timer");
  assert.equal((await flush(59999)).details, "Alternative");
  assert.equal((await flush(10001)).details, "Workspace");
  config.detailsTemplates = ["New alternative"];
  assert.equal((await flush(10000)).details, "New alternative");
  config.shuffleDetails = false;
  assert.equal((await flush(10000)).details, "Workspace");
  assert.equal(r.mod.detailsShuffle, null);
  config.shuffleDetails = true;
  config.enabled = false;
  assert.equal(await flush(10000), null);
  assert.equal(r.mod.detailsShuffle, null);
});

test("Details shuffle supports a single template and keeps privacy and State intact", async () => {
  const r = runtime({ Math: { random: () => 0.99, floor: Math.floor } });
  const single = { shuffleDetails: true, detailsTemplate: "Only", detailsTemplates: ["Only"] };
  assert.equal(r.mod.detailsConfig(single).detailsTemplate, "Only");
  r.advance(180000);
  assert.equal(r.mod.detailsConfig(single).detailsTemplate, "Only");
  const config = r.mod.detailsConfig({ shuffleDetails: true, detailsTemplates: ["{workspace} | {branch}"], privatePatterns: ["Secret"] });
  const activity = buildActivity({ spaces: [{ id: "s", name: "Secret", active: true }], agents: [], terminals: [], panes: [] }, config);
  assert.equal(activity.details, "Private workspace");
  assert.equal(activity.state, "0/0 agents active");
});

test("pane host coalesces concurrent flushes and renews its heartbeat outside mods", async () => {
  const r = runtime();
  r.mod.init({}, r.cx);
  r.mod.flush(r.cx);
  await Promise.all(r.tasks);
  assert.equal(r.timers[0][0], 1000);
  assert.equal(r.writes.length, 1);
  assert.equal(r.writes[0][0], "/app/data/discord-rpc/.presence.json");
  const snapshot = JSON.parse(r.writes[0][1]);
  assert.equal(snapshot.version, 1);
  assert.ok(Math.abs(Date.now() - snapshot.updatedAt) < 1000);
  assert.equal(snapshot.activity, null);
  assert.equal(r.calls[0][0], "node");
  assert.deepEqual(Array.from(r.calls[0][1]), ["/app/mods/discord-rpc/bridge.mjs", "--start", "/app/mods/discord-rpc"]);
  r.tick();
  await Promise.all(r.tasks);
  assert.equal(r.writes.length, 1, "an unchanged host does not rewrite each second");
  r.advance(10001);
  r.tick();
  await Promise.all(r.tasks);
  assert.equal(r.writes.length, 2);
  assert.ok(JSON.parse(r.writes[1][1]).updatedAt > snapshot.updatedAt);
});

test("live changes during an in-flight pane write are not lost", async () => {
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

test("an unrendered pane timer reads fresh agent state instead of retaining the last render", async () => {
  const agent = { address: "remote/t1", app: "pi", status: "working", space: "remote/s1" };
  const r = runtime({
    agents: () => [{ ...agent }],
    spaces: () => [{ id: "remote/s1", name: "Project", active: true }],
    terminals: () => [{ address: "remote/t1", state: "live", parent: null }],
    focused: () => ({ space: "remote/s1", terminal: "remote/t1" }),
  });
  r.mod.init({}, r.cx);
  await Promise.all(r.tasks);
  assert.equal(JSON.parse(r.writes[0][1]).activity.state, "Pi · 1/1 agents active");
  agent.app = "codex";
  agent.status = "idle";
  r.advance(10001);
  r.tick();
  await Promise.all(r.tasks);
  assert.equal(JSON.parse(r.writes.at(-1)[1]).activity.state, "Codex · 0/1 agents active");
});

test("invalid pane configuration writes null rather than retaining old presence", async () => {
  const r = runtime({ readTextFile: async path => path.endsWith("/config.json") ? '{"clientId":"123456789012345678","privatePatterns":"broken"}' : null });
  r.mod.init({}, r.cx);
  await Promise.all(r.tasks);
  assert.equal(JSON.parse(r.writes[0][1]).activity, null);
});

for (const props of [null, {}, { host: true }, { presenceHost: false }, { presenceHost: "true" }]) {
  test(`legacy layout host is inert with props ${JSON.stringify(props)}`, async () => {
    const r = runtime({ props: () => props });
    r.mod.init({}, r.cx);
    assert.equal(r.mod.render(), r.empty);
    assert.equal(r.mod.render(), r.empty);
    await r.mod.close?.();
    assert.equal(r.writes.length, 0);
    assert.equal(r.calls.length, 0);
    assert.equal(r.tasks.length, 0);
    assert.equal(r.timers.length, 0);
  });
}

for (const props of [{ overlay: "settings" }, { overlay: "settings", launcher: true }, { overlay: "settings", presenceHost: true }]) {
  test(`opening and closing settings never starts or clears presence with props ${JSON.stringify(props)}`, async () => {
    const calls = [];
    let lookupBranch;
    const r = runtime({
      props: () => props,
      Settings: class {
        init(_props, _cx, branch) { calls.push("init"); lookupBranch = branch; }
        render() { calls.push("render"); return "settings"; }
      },
    });
    r.mod.init({}, r.cx);
    assert.equal(r.mod.render(), "settings");
    assert.equal(typeof lookupBranch, "function");
    r.mod.branch = async data => data.branch;
    assert.equal(await lookupBranch({ branch: "preview" }), "preview");
    await r.mod.close?.();
    assert.deepEqual(calls, ["init", "render"]);
    assert.equal(r.writes.length, 0);
    assert.equal(r.calls.length, 0);
    assert.equal(r.tasks.length, 0);
    assert.equal(r.timers.length, 0);
  });
}

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
    props: () => ({ launcher: true, presenceHost: true }),
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
  await r.mod.close?.();
  assert.equal(r.writes.length, 0);
  assert.equal(r.calls.length, 0);
  assert.equal(r.tasks.length, 0);
  assert.equal(r.timers.length, 0);
});

for (const failure of [null, "missing", "rejected", "exception"]) {
  test(`host collapse button resizes only the RPC pane (${failure ?? "success"})`, async () => {
    const buttons = new Map();
    const r = runtime({
      panes: () => [{ pane: "terminal" }, ...(failure === "missing" ? [] : [{ pane: "rpc", mod: "discord-rpc" }])],
      focused: () => ({ pane: "terminal" }),
      Button: { new: id => {
        const state = {};
        const button = new Proxy({}, { get: (_target, key) => (...args) => {
          state[key] = args[0];
          return button;
        } });
        buttons.set(id, state);
        return button;
      } },
      exec: async (command, args) => {
        assert.equal(command, "herdr-app");
        assert.deepEqual(Array.from(args).slice(0, 2), ["do", "layout.resize"]);
        assert.deepEqual(JSON.parse(args[2]), { id: "rpc", px: 0 });
        if (failure === "exception") throw new Error("Transport failed");
        return { code: failure === "rejected" ? 1 : 0, stderr: "Resize rejected" };
      },
    });
    r.mod.host = true;
    r.mod.render();
    const button = buttons.get("discord-pane-collapse");
    assert.equal(button.child, "Collapse to 0px");
    assert.equal(button.accessibility_label, "Collapse RPC pane to 0px");
    assert.equal(button.tab_index, 0);
    button.on_click({}, r.cx);
    await Promise.all(r.tasks);
    assert.equal(Boolean(r.mod.collapseError), Boolean(failure));
    if (failure) assert.match(r.mod.collapseError, /Could not collapse RPC pane/);
    assert.equal(r.mod.closing, undefined, "collapsing does not close the presence host");
    assert.equal(r.writes.length, 0);
  });
}

test("closing a pane clears once and stops subsequent timer writes", async () => {
  const r = runtime();
  r.mod.init({}, r.cx);
  await Promise.all(r.tasks);
  await r.mod.close();
  assert.equal(JSON.parse(r.writes.at(-1)[1]).activity, null);
  const count = r.writes.length;
  r.advance(10001);
  r.tick();
  await Promise.all(r.tasks);
  assert.equal(r.writes.length, count);
});

test("an in-flight pane flush cannot overwrite the close clear or restart its helper", async () => {
  let release;
  const config = new Promise(resolve => { release = resolve; });
  const r = runtime({ readTextFile: path => path.endsWith("/config.json") ? config : Promise.resolve(null) });
  r.mod.init({}, r.cx);
  await r.mod.close();
  release('{"clientId":"123456789012345678","enabled":true}');
  await Promise.all(r.tasks);
  assert.equal(r.writes.length, 1);
  assert.equal(JSON.parse(r.writes[0][1]).activity, null);
  assert.equal(r.calls.length, 0);
});

test("pane close retries a stale snapshot caused by an already-started flush", async () => {
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
  r.mod.host = true;
  r.mod.runtimeDirectory = "/app/data/discord-rpc";
  await r.mod.close();
  assert.equal(attempts, 2);
  assert.equal(r.mod.closing, true);
  assert.equal(JSON.parse(state).activity, null);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { buildActivity, DEFAULT_DETAILS, DEFAULT_STATE, isPrivate, parseConfig, VARIABLES } from "../mods/discord-rpc/presence.js";

const source = (await readFile(new URL("../mods/discord-rpc/settings.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/gm, "").replace("export default class", "class") + "\nSettings;";
const initial = { clientId: "1529832902387302510", enabled: true, privatePatterns: [], largeImageKey: "herdr", customSetting: "preserve" };
const plain = value => JSON.parse(JSON.stringify(value));

function runtime(value = initial, overrides = {}) {
  const tasks = [], writes = [], elements = new Map();
  let disk = value === null ? null : typeof value === "string" ? value : JSON.stringify(value);
  let closed = 0;
  function element(id) {
    const data = { nodeChildren: [], nodeId: id };
    let proxy;
    proxy = new Proxy(data, { get(target, name) {
      if (name in target) return target[name];
      return (...args) => {
        if (name === "when") { if (args[0]) args[1](proxy); }
        else if (name === "child") data.nodeChildren.push(args[0]);
        else if (name === "children") data.nodeChildren.push(...args[0]);
        else if (name === "id") { data.nodeId = args[0]; elements.set(args[0], proxy); }
        else if (name === "h_full") data.fullHeight = true;
        else if (name === "on_click") data.click = args[0];
        else if (name === "disabled") data.isDisabled = args[0];
        return proxy;
      };
    } });
    if (id) elements.set(id, proxy);
    return proxy;
  }
  function input({ value = "" } = {}) {
    let text = value, range = { start: text.length, end: text.length };
    const handlers = {};
    return {
      value: () => text,
      set_value(value) { text = value; range = { start: text.length, end: text.length }; },
      set_selected_range(next) { range = next; },
      replace(value) { text = text.slice(0, range.start) + value + text.slice(range.end); },
      focus() { handlers.focus?.({}, cx); },
      release() {},
      on(event, body) { handlers[event] = body; },
    };
  }
  const cx = {
    timer: { every() {} },
    focus_handle: () => ({ focus() {}, is_focused: () => false }),
    notify() {},
    spawn(body) { tasks.push(body(cx)); },
  };
  const Class = vm.runInNewContext(source, {
    View: class {}, div: () => element(), image: () => element(), h_flex: () => element(), v_flex: () => element(),
    Button: { new: element }, Checkbox: { new: element }, Input: { new: () => element() }, InputState: { new: input },
    appHome: () => "/app", props: () => ({ overlay: "settings" }), closeOverlay: () => closed++,
    agents: () => [], terminals: () => [], panes: () => [], spaces: () => [{ id: "s", name: "client-acme", active: true }],
    focused: () => ({ space: "s" }), theme: () => ({}),
    readTextFile: async path => path.endsWith("/config.json") ? disk : null,
    writeTextFile: async (path, next, expected) => {
      if (disk !== expected) throw new Error("stale snapshot");
      writes.push({ path, config: JSON.parse(next) });
      disk = next;
    },
    buildActivity, DEFAULT_DETAILS, DEFAULT_STATE, isPrivate, parseConfig, VARIABLES,
    exec: () => assert.fail("settings must not launch commands without a pane action"),
    run: () => assert.fail("settings must not run commands without a pane action"),
    ...overrides,
  });
  const settings = new Class();
  const drain = async () => { for (let i = 0; i < tasks.length; i++) await tasks[i]; };
  return { settings, cx, drain, writes, elements, get closed() { return closed; }, setDisk(value) { disk = value; } };
}

test("settings load existing config without writing or starting another presence host", async () => {
  const r = runtime();
  r.settings.init({}, r.cx);
  await r.drain();
  assert.equal(r.settings.loaded, true);
  assert.equal(r.settings.inputs.detailsTemplate.value(), DEFAULT_DETAILS);
  assert.equal(r.settings.displayType, "name");
  assert.equal(r.writes.length, 0);
  r.settings.render();
  assert.ok(r.elements.has("save"));
  assert.equal(r.elements.get("discord-settings").fullHeight, true, "the native scrollbar needs a full-height parent");
});

test("stopped status points to the RPC pane and its tab", async () => {
  const r = runtime();
  r.settings.init({}, r.cx);
  await r.drain();
  function text(node) {
    if (typeof node === "string") return node;
    return (node?.nodeChildren ?? []).map(text).join("\n");
  }
  const rendered = text(r.settings.render());
  assert.match(rendered, /RPC pane is not running/);
  assert.match(rendered, /Visit its tab/);
  assert.doesNotMatch(rendered, /RPC layout/);
});

test("pane recovery creates a zero-width explicit host without saving or discarding drafts", async () => {
  const commands = [], focus = [];
  const r = runtime(initial, {
    focused: () => ({ space: "s", pane: "original" }),
    exec: async (program, args) => {
      commands.push([program, args[1], JSON.parse(args[2])]);
      return { code: 0, stdout: JSON.stringify(args[1] === "pane.split" ? { pane: "new-rpc" } : { ok: true }) };
    },
    run: (...args) => focus.push(plain(args)),
  });
  r.settings.init({}, r.cx);
  await r.drain();
  r.settings.inputs.stateTemplate.set_value("Unsaved {workspace}");
  r.settings.render();
  r.elements.get("create-rpc-pane").click({}, r.cx);
  r.settings.createPane(r.cx);
  assert.equal(r.settings.creatingPane, true);
  r.settings.render();
  assert.equal(r.elements.get("create-rpc-pane").isDisabled, true);
  await r.drain();
  assert.deepEqual(commands, [
    ["herdr-app", "pane.split", { direction: "right", pane: "original", mod: "discord-rpc", props: { presenceHost: true } }],
    ["herdr-app", "layout.resize", { id: "new-rpc", px: 0 }],
  ]);
  assert.deepEqual(focus, [["pane.focus", { pane: "original" }]]);
  assert.equal(r.settings.inputs.stateTemplate.value(), "Unsaved {workspace}");
  assert.equal(r.writes.length, 0);
  assert.equal(r.closed, 0);
  assert.equal(r.settings.creatingPane, false);
  assert.match(r.settings.notice, /Invisible RPC pane created/);
});

test("pane recovery reuses an existing pane even when its heartbeat is stale", async () => {
  const commands = [];
  const r = runtime(initial, {
    panes: () => [{ mod: "discord-rpc", pane: "existing" }],
    run: (...args) => commands.push(plain(args)),
  });
  r.settings.init({}, r.cx);
  await r.drain();
  assert.equal(r.settings.hostLive, false);
  r.settings.render();
  assert.deepEqual(r.elements.get("create-rpc-pane").nodeChildren, ["Go to RPC pane"]);
  r.elements.get("create-rpc-pane").click({}, r.cx);
  assert.deepEqual(commands, [["pane.focus", { pane: "existing" }]]);
  assert.equal(r.writes.length, 0);
  assert.match(r.settings.notice, /No new pane/);
});

test("pane recovery requires a tab pane instead of splitting an unrelated terminal", async () => {
  const r = runtime();
  r.settings.init({}, r.cx);
  await r.drain();
  r.settings.createPane(r.cx);
  assert.match(r.settings.error, /Select a pane/);
  assert.equal(r.writes.length, 0);
});

for (const failure of ["split", "resize", "response"]) {
  test(`pane recovery reports ${failure} failure without saving settings`, async () => {
    const commands = [];
    const r = runtime(initial, {
      focused: () => ({ space: "s", pane: "original" }),
      exec: async (_program, args) => {
        commands.push(args[1]);
        if (failure === "split" || failure === "resize" && args[1] === "layout.resize") return { code: 1, stderr: "Operation rejected" };
        return { code: 0, stdout: failure === "response" ? "{}" : '{"pane":"new-rpc"}' };
      },
      run: () => {},
    });
    r.settings.init({}, r.cx);
    await r.drain();
    r.settings.createPane(r.cx);
    await r.drain();
    assert.match(r.settings.error, failure === "response" ? /new pane ID/ : /Operation rejected/);
    if (failure === "resize") assert.match(r.settings.error, /RPC pane created/);
    assert.equal(commands.length, failure === "resize" ? 2 : 1);
    assert.equal(r.settings.creatingPane, false);
    assert.equal(r.closed, 0);
    assert.equal(r.writes.length, 0);
  });
}

test("pause persists immediately without saving draft edits, and Cancel cannot resume it", async () => {
  const r = runtime();
  r.settings.init({}, r.cx);
  await r.drain();
  r.settings.inputs.stateTemplate.set_value("Draft {workspace}");
  r.settings.sharing(false, r.cx);
  await r.drain();
  assert.equal(r.writes.length, 1);
  assert.equal(r.writes[0].path, "/app/mods/discord-rpc/config.json");
  assert.deepEqual(r.writes[0].config, { ...initial, enabled: false });
  assert.equal(r.settings.inputs.stateTemplate.value(), "Draft {workspace}");
  assert.equal(r.closed, 0);
  r.settings.render();
  r.elements.get("cancel").click({}, r.cx);
  assert.equal(r.closed, 1);
  assert.equal(r.writes.length, 1);
});

test("Save applies all draft controls together, preserves unknown settings, and closes", async () => {
  const r = runtime();
  r.settings.init({}, r.cx);
  await r.drain();
  r.settings.inputs.detailsTemplate.set_value("{agents.total} agents");
  r.settings.inputs.stateTemplate.set_value("{workspace}");
  r.settings.inputs.pattern.set_value("client-*");
  r.settings.artwork = false;
  r.settings.harnessIcon = false;
  r.settings.displayType = "state";
  r.settings.save(r.cx);
  await r.drain();
  const saved = r.writes[0].config;
  assert.equal(saved.customSetting, "preserve");
  assert.equal(saved.largeImageKey, undefined);
  assert.equal(saved.showHarnessIcon, false);
  assert.deepEqual(saved.privatePatterns, ["client-*"]);
  assert.equal(saved.stateTemplate, "{workspace}");
  assert.equal(saved.detailsTemplate, "{agents.total} agents");
  assert.equal(saved.statusDisplayType, "state");
  assert.equal(r.closed, 1);
});

test("invalid templates block Save and preview; private rules apply to both preview fields", async () => {
  const r = runtime();
  r.settings.init({}, r.cx);
  await r.drain();
  r.settings.inputs.stateTemplate.set_value("{unknown}");
  r.settings.save(r.cx);
  r.settings.render();
  assert.match(r.settings.error, /Unknown variable/);
  assert.equal(r.elements.get("save").isDisabled, true);
  assert.equal(r.writes.length, 0);
  r.settings.inputs.stateTemplate.set_value("{workspace}");
  r.settings.inputs.pattern.set_value("client-*");
  const preview = buildActivity({ agents: [], terminals: [], panes: [], spaces: [{ id: "s", name: "client-acme", active: true }] }, plain(r.settings.draft()));
  assert.equal(preview.details, "Private workspace");
  assert.equal(preview.state, "Private workspace");
});

test("external config changes cause a save conflict instead of overwriting newer settings", async () => {
  const r = runtime();
  r.settings.init({}, r.cx);
  await r.drain();
  r.setDisk(JSON.stringify({ ...initial, customSetting: "external" }));
  r.settings.save(r.cx);
  await r.drain();
  assert.match(r.settings.error, /stale snapshot/);
  assert.equal(r.writes.length, 0);
  assert.equal(r.closed, 0);
  r.settings.load(r.cx);
  await r.drain();
  assert.equal(r.settings.config.customSetting, "external");
  r.settings.save(r.cx);
  await r.drain();
  assert.equal(r.writes[0].config.customSetting, "external");
});

test("a failed immediate pause restores the persisted on state and displays an error", async () => {
  const r = runtime();
  r.settings.init({}, r.cx);
  await r.drain();
  r.setDisk("changed externally");
  r.settings.sharing(false, r.cx);
  await r.drain();
  assert.equal(r.settings.enabled, true);
  assert.match(r.settings.error, /Could not save/);
});

test("variable buttons insert at the selected cursor range of the last focused field", async () => {
  const r = runtime();
  r.settings.init({}, r.cx);
  await r.drain();
  const input = r.settings.inputs.stateTemplate;
  input.set_value("Before replace after");
  input.set_selected_range({ start: 7, end: 14 });
  input.focus();
  r.settings.render();
  r.elements.get("variable-agents.total").click({}, r.cx);
  assert.equal(input.value(), "Before {agents.total} after");
  assert.equal(r.settings.inputs.detailsTemplate.value(), DEFAULT_DETAILS);
});

test("missing config starts with defaults; malformed config is never silently overwritten", async () => {
  for (const [source, loaded] of [[null, true], ["broken JSON", false]]) {
    const r = runtime(source);
    r.settings.init({}, r.cx);
    await r.drain();
    assert.equal(r.settings.loaded, loaded);
    assert.equal(r.writes.length, 0);
    if (!loaded) assert.match(r.settings.error, /Fix the file/);
  }
});

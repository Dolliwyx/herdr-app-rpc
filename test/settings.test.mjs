import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { buildActivity, DEFAULT_DETAILS, DEFAULT_STATE, isPrivate, parseConfig, VARIABLES } from "../mods/discord-rpc/presence.js";

const source = (await readFile(new URL("../mods/discord-rpc/settings.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/gm, "").replace("export default class", "class") + "\nSettings;";
const initial = { clientId: "1529832902387302510", enabled: true, privatePatterns: [], largeImageKey: "herdr", customSetting: "preserve" };
const plain = value => JSON.parse(JSON.stringify(value));

function runtime(value = initial) {
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

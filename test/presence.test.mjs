import assert from "node:assert/strict";
import test from "node:test";
import { buildActivity, parseConfig } from "../mods/discord-rpc/presence.js";

const config = { clientId: "123456789012345678", largeImageKey: "herdr", privatePatterns: ["client-*", "Personal"] };
function fixture() {
  return {
    spaces: [{ id: "s1", name: "herdr-app-rpc", active: true, branch: "stale-space-branch" }, { id: "s2", name: "Other" }],
    agents: [
      { address: "wsl/t1", space: "s1", app: "pi", status: "working", program: { key: "pi", name: "Pi" } },
      { address: "t2", space: "s2", app: "claude-code", status: "blocked", program: { key: "claude" } },
      { address: "wsl/t3", space: "s1", app: "codex", status: "working", program: { key: "codex" } },
      { address: "t4", space: "s2", app: "pi", status: "idle" },
      { address: "t5", space: "s2", app: "pi", status: "done" },
    ],
    terminals: [
      { address: "wsl/t1", state: "live", parent: null, cwd: "/secret/path" },
      { address: "t2", state: "live", parent: null },
      { address: "wsl/t3", state: "live", parent: "wsl/t1" },
      { address: "t4", state: "live", parent: null },
      { address: "t5", state: "live", parent: null },
    ],
    panes: [{ pane: "p1", terminal: "wsl/t1", branch: "master" }],
    focus: { space: "s1", pane: "p1", terminal: "wsl/t1", shown: null },
  };
}

test("uses focused workspace/branch/harness and app-wide root counts", () => {
  assert.deepEqual(buildActivity(fixture(), config), {
    name: "Herdr",
    type: 0,
    details: "herdr-app-rpc · master",
    state: "Pi · 1/4 agents active",
    assets: { large_image: "herdr", large_text: "Herdr", small_image: "pi", small_text: "Pi" },
  });
});

test("only live reporting roots count, never missing or finished terminals", () => {
  const data = fixture();
  data.terminals[0].state = "exited";
  data.terminals.splice(1, 1);
  assert.match(buildActivity(data, config).state, /0\/2 agents active$/);
});

test("focused non-Git pane does not inherit another pane's branch", () => {
  const data = fixture();
  data.panes[0].branch = null;
  assert.equal(buildActivity(data, config).details, "herdr-app-rpc");
});

test("branch fallback supports unborn repos without overriding native metadata", () => {
  const data = fixture();
  data.panes[0].branch = null;
  assert.equal(buildActivity(data, config, "master").details, "herdr-app-rpc · master");
  data.panes[0].branch = "native";
  assert.equal(buildActivity(data, config, "fallback").details, "herdr-app-rpc · native");
  data.spaces[0].name = "Personal";
  assert.equal(buildActivity(data, config, "secret").details, "Private workspace");
  data.focus.terminal = null;
  data.spaces[0].name = "public";
  assert.equal(buildActivity(data, config, "unfocused").details, "public");
});

test("shell focus falls back to current workspace harnesses, not other spaces", () => {
  const data = fixture();
  data.focus.terminal = "shell";
  data.agents.push({ address: "t6", space: "s1", app: "codex", status: "idle" });
  data.terminals.push({ address: "t6", state: "live", parent: null });
  const activity = buildActivity(data, config);
  assert.equal(activity.state, "Pi + Codex · 1/5 agents active");
  assert.equal(activity.assets.small_image, undefined);
});

test("a focused sub-agent can name its harness without increasing root counts", () => {
  const data = fixture();
  data.focus.terminal = "wsl/t3";
  data.panes.push({ terminal: "wsl/t3", branch: "child-branch" });
  const activity = buildActivity(data, config);
  assert.equal(activity.details, "herdr-app-rpc · child-branch");
  assert.equal(activity.state, "Codex · 1/4 agents active");
});

test("terminal.show replacements use the shown terminal, not the source branch", () => {
  const data = fixture();
  data.focus.shown = "t2";
  data.panes.push({ terminal: "t2", branch: "replacement" });
  assert.equal(buildActivity(data, config).details, "herdr-app-rpc · replacement");
  assert.equal(buildActivity(data, config).state, "Claude Code · 1/4 agents active");
});

test("private terminal replacements cannot disclose their branch in a public space", () => {
  const data = fixture();
  data.focus.shown = "t2";
  data.spaces[1].name = "client-acme";
  data.panes.push({ terminal: "t2", branch: "customer-secret" });
  assert.equal(buildActivity(data, config).details, "Private workspace");
});

test("private shell ownership is resolved from machine-local terminal labels", () => {
  const data = fixture();
  data.focus.shown = "remote/shell";
  data.spaces.push({ id: "remote/private", name: "Personal" });
  data.terminals.push({ address: "remote/shell", state: "live", labels: { "herdr.space": "private" } });
  data.panes.push({ terminal: "remote/shell", branch: "secret" });
  assert.equal(buildActivity(data, config).details, "Private workspace");
});

test("remote owner labels cannot collide with public local space IDs", () => {
  const data = fixture();
  data.focus.shown = "remote/shell";
  data.spaces.push({ id: "remote/s1", name: "Personal" });
  data.terminals.push({ address: "remote/shell", state: "live", labels: { "herdr.space": "s1" } });
  data.panes.push({ terminal: "remote/shell", branch: null });
  assert.equal(buildActivity(data, config, "customer-secret").details, "Private workspace");
});

test("reported agent ownership wins over a colliding terminal label", () => {
  const data = fixture();
  data.focus.shown = "t2";
  data.spaces[1].name = "Personal";
  data.terminals[1].labels = { "herdr.space": "s1" };
  data.panes.push({ terminal: "t2", branch: "secret" });
  assert.equal(buildActivity(data, config).details, "Private workspace");
});

test("a focused mod pane cannot inherit an unrelated first-terminal branch", () => {
  const data = fixture();
  data.focus.terminal = null;
  data.focus.agent = "wsl/t1";
  assert.equal(buildActivity(data, config).details, "herdr-app-rpc");
});

test("composition blocks resolve by terminal address even without a pane id", () => {
  const data = fixture();
  data.focus.pane = null;
  assert.equal(buildActivity(data, config).details, "herdr-app-rpc · master");
});

test("private glob patterns mask workspace and branch, case-insensitively", () => {
  for (const name of ["Client-acme", "PERSONAL"]) {
    const data = fixture();
    data.spaces[0].name = name;
    data.panes[0].branch = "customer-secret";
    const activity = buildActivity(data, config);
    assert.equal(activity.details, "Private workspace");
    assert.doesNotMatch(JSON.stringify(activity), /acme|customer-secret|secret\/path/i);
    assert.equal(activity.state, "Pi · 1/4 agents active");
  }
});

test("privacy patterns escape regex syntax and support ?", () => {
  const data = fixture();
  data.spaces[0].name = "a.[x]1";
  assert.equal(buildActivity(data, { ...config, privatePatterns: ["a.[x]?"] }).details, "Private workspace");
  assert.notEqual(buildActivity(data, { ...config, privatePatterns: ["a.*[y]?"] }).details, "Private workspace");
});

test("disabled config and missing workspace clear presence", () => {
  assert.equal(buildActivity(fixture(), { ...config, enabled: false }), null);
  assert.equal(buildActivity({ ...fixture(), spaces: [] }, config), null);
});

test("still shows Herdr with 0/0 reporting agents", () => {
  const data = fixture();
  data.agents = [];
  assert.equal(buildActivity(data, config).state, "0/0 agents active");
});

test("asset configuration is optional", () => {
  assert.equal(buildActivity(fixture(), {}).assets, undefined);
  const activity = buildActivity(fixture(), { ...config, showHarnessIcon: false });
  assert.deepEqual(activity.assets, { large_image: "herdr", large_text: "Herdr" });
});

test("cleans controls, bounds Unicode fields, and never includes raw terminal data", () => {
  const data = fixture();
  data.spaces[0].name = "🐑".repeat(150) + "\n";
  data.agents[0].title = "sensitive prompt";
  const activity = buildActivity(data, config);
  assert.ok(Array.from(activity.details).length <= 128);
  assert.doesNotMatch(JSON.stringify(activity), /sensitive prompt|secret\/path|\\n/);
  assert.ok(!/[\uD800-\uDBFF]$/.test(activity.details));
});

test("long harness/workspace labels retain counts and branch", () => {
  const data = fixture();
  data.agents[0].app = "Custom harness ".repeat(30);
  data.spaces[0].name = "workspace".repeat(30);
  const activity = buildActivity(data, config);
  assert.match(activity.state, /1\/4 agents active$/);
  assert.match(activity.details, / · master$/);
  assert.ok(Array.from(activity.state).length <= 128);
  assert.ok(Array.from(activity.details).length <= 128);
});

test("an unknown reported app wins over the program table", () => {
  const data = fixture();
  data.agents[0].app = "My harness";
  assert.equal(buildActivity(data, config).state, "My harness · 1/4 agents active");
});

test("validates config instead of interpreting invalid privacy/enable settings", () => {
  assert.deepEqual(parseConfig(JSON.stringify(config)), config);
  for (const bad of [null, {}, { clientId: 123456789012345678 }, { ...config, enabled: "false" }, { ...config, privatePatterns: "client-*" }, { ...config, largeImageKey: "" }, { ...config, showHarnessIcon: "true" }]) {
    assert.throws(() => parseConfig(JSON.stringify(bad)));
  }
  assert.throws(() => parseConfig("broken JSON"));
});

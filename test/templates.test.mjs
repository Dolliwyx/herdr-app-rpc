import assert from "node:assert/strict";
import test from "node:test";
import { buildActivity, DEFAULT_DETAILS, DEFAULT_STATE, parseConfig, renderTemplate } from "../mods/discord-rpc/presence.js";

const config = { clientId: "1529832902387302510" };
const data = () => ({
  spaces: [{ id: "s1", name: "client-acme", active: true }],
  terminals: [{ address: "t1", state: "live" }],
  agents: [{ address: "t1", space: "s1", app: "pi", status: "working" }],
  panes: [{ terminal: "t1", branch: "customer-secret" }],
  focus: { space: "s1", terminal: "t1" },
});

test("templates can move all supported variables between either activity field", () => {
  const activity = buildActivity(data(), {
    ...config,
    detailsTemplate: "{agents.running} running / {agents.total} total · {harness}",
    stateTemplate: "{branch} | {workspace}",
    statusDisplayType: "details",
  });
  assert.equal(activity.details, "1 running / 1 total · Pi");
  assert.equal(activity.state, "customer-secret | client-acme");
  assert.equal(activity.status_display_type, 2);
});

test("private workspaces and borrowed private terminals stay private in every template", () => {
  for (const borrowed of [false, true]) {
    const fixture = data();
    if (borrowed) {
      fixture.spaces.push({ id: "public", name: "Public" });
      fixture.focus.space = "public";
    }
    const activity = buildActivity(fixture, {
      ...config,
      privatePatterns: ["CLIENT-*"],
      detailsTemplate: "{branch} · {workspace} · {branch}",
      stateTemplate: "{workspace} | {branch} | {harness} | {agents.running}/{agents.total}",
      statusDisplayType: "state",
    });
    assert.equal(activity.details, "Private workspace");
    assert.equal(activity.state, "Private workspace | Pi | 1/1");
    assert.doesNotMatch(JSON.stringify(activity), /client-acme|customer-secret/);
    assert.equal(activity.status_display_type, 1);
  }
});

test("empty variables remove adjacent template separators but never variable punctuation", () => {
  const values = { workspace: "-my/repo-", branch: "", harness: "", "agents.running": 0, "agents.total": 0 };
  for (const template of [DEFAULT_DETAILS, "{branch} · {workspace}", "{branch} · {harness} · {workspace}", "{workspace} | {branch} | {harness}"]) {
    assert.equal(renderTemplate(template, values), "-my/repo-");
  }
  assert.equal(renderTemplate(DEFAULT_STATE, values), "0/0 agents active");
  assert.equal(renderTemplate("Branch: {branch}", values), "Branch");
  assert.equal(renderTemplate("{branch}", values), "");
});

test("template values are substituted once and output is sanitized and Unicode-bounded", () => {
  assert.equal(renderTemplate("{workspace}", { workspace: "{branch}\nHello" }), "{branch} Hello");
  const value = renderTemplate("{workspace}", { workspace: "🐑".repeat(200) });
  assert.equal(Array.from(value).length, 128);
  assert.ok(!/[\uD800-\uDBFF]$/.test(value));
});

test("explicit default templates preserve existing formatting and suffix budgets", () => {
  const fixture = data();
  fixture.spaces[0].name = "workspace".repeat(30);
  assert.deepEqual(buildActivity(fixture, { ...config, detailsTemplate: DEFAULT_DETAILS, stateTemplate: DEFAULT_STATE }), buildActivity(fixture, config));
});

test("blank templates omit optional fields and one-character text remains valid", () => {
  const activity = buildActivity(data(), { ...config, detailsTemplate: "", stateTemplate: "x" });
  assert.equal(activity.details, undefined);
  assert.equal(activity.state, "In x");
  assert.equal(buildActivity(data(), { ...config, detailsTemplate: "", statusDisplayType: "details" }).status_display_type, 0);
});

test("unknown variables, malformed braces, invalid types and display choices are rejected", () => {
  for (const template of ["{model}", "{toString}", "{__proto__}", "{workspace", "workspace}", "{{branch}}", null, 42, "a".repeat(513)]) {
    for (const key of ["detailsTemplate", "stateTemplate"]) {
      assert.throws(() => parseConfig(JSON.stringify({ ...config, [key]: template })));
    }
  }
  for (const statusDisplayType of ["other", 1, null]) {
    assert.throws(() => parseConfig(JSON.stringify({ ...config, statusDisplayType })));
  }
  for (const statusDisplayType of ["name", "state", "details"]) {
    assert.equal(parseConfig(JSON.stringify({ ...config, statusDisplayType })).statusDisplayType, statusDisplayType);
  }
});

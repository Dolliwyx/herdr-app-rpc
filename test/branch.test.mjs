import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const source = (await readFile(new URL("../mods/discord-rpc/main.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/gm, "").replace("export default class", "class") + "\nDiscordRpc;";
function modWith(exec) {
  const Class = vm.runInNewContext(source, { View: class {}, exec, console: { log() {} } });
  return new Class();
}
const data = (address = "wsl/t1", cwd = "/repo") => ({ focus: { terminal: address, cwd }, panes: [] });

test("missing branch lookup runs on the terminal's machine and caches its cwd", async () => {
  const calls = [];
  const mod = modWith(async (...args) => { calls.push(args); return { code: 0, stdout: "master\n" }; });
  assert.equal(await mod.branch(data()), "master");
  assert.equal(await mod.branch(data()), "master");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "git");
  assert.equal(calls[0][2].cwd, "/repo");
  assert.equal(calls[0][2].on, "wsl");
  await mod.branch(data("t2", "C:\\repo"));
  assert.equal(calls.length, 2);
  assert.equal(calls[1][2].on, null);
});

test("native branch metadata and mod focus never launch Git", async () => {
  const mod = modWith(async () => { assert.fail("unexpected Git lookup"); });
  const native = data();
  native.panes.push({ terminal: "wsl/t1", cwd: "/repo", branch: "native" });
  assert.equal(await mod.branch(native), "native");
  assert.equal(await mod.branch(data(null)), undefined);
});

test("Git errors and non-Git directories omit only the branch", async () => {
  const failed = modWith(async () => ({ code: 128, stdout: "", stderr: "not a git repository" }));
  assert.equal(await failed.branch(data()), null);
  const unavailable = modWith(async () => { throw new Error("machine unavailable"); });
  assert.equal(await unavailable.branch(data()), null);
});

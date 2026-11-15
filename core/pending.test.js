import { expect, test } from "bun:test";
import { PENDING, settle } from "./pending.js";

const pending = (job) => ({ code: PENDING, stdout: JSON.stringify({ error: "Still running on vmb", pending: job, machine: "vmb" }), stderr: "" });
const done = { code: 0, stdout: JSON.stringify({ id: 1, state: "done" }), stderr: "" };

test("an action still running there is followed to its real result (SHEP-227)", async () => {
  const asked = [];
  const answers = [pending("ab12"), done];
  const r = await settle(async (a) => { asked.push(a); return answers.shift(); }, pending("ab12"));
  expect(r).toEqual(done);
  expect(asked).toEqual([["--on", "vmb", "_job", "ab12", "--json"], ["--on", "vmb", "_job", "ab12", "--json"]]);
});

test("a result, an error or a plain failure is left as it is", async () => {
  const run = async () => { throw new Error("not asked"); };
  expect(await settle(run, done)).toEqual(done);
  const failed = { code: 1, stdout: JSON.stringify({ error: "Can't reach vmb" }), stderr: "" };
  expect(await settle(run, failed)).toEqual(failed);
  const odd = { code: PENDING, stdout: "not json", stderr: "" };
  expect(await settle(run, odd)).toEqual(odd);
});

test("it gives up after its rounds with the last words, and a throw is an error", async () => {
  let n = 0;
  const r = await settle(async () => { n++; return pending("cd34"); }, pending("cd34"), 3);
  expect(n).toBe(3);
  expect(r.code).toBe(PENDING);
  const t = await settle(async () => { throw new Error("herdr.exec stopped"); }, pending("ef56"));
  expect(t).toEqual({ code: 1, stdout: "", stderr: "herdr.exec stopped" });
});

import { expect, test } from "bun:test";
import { join } from "node:path";
import { checkFlags } from "./flags.ts";

// this branch's own herdr-task, moving nothing (SHEPHERDR_NO_MIGRATE); only its `flags` check runs
process.env.SHEPHERDR_NO_MIGRATE = "1";
const BIN = join(import.meta.dir, "..", "mods", "tasks", "bin", "herdr-task");

test("#1222: Settings › Tasks' extra flags are checked by herdr-task and kept as its list", async () => {
  expect(await checkFlags("claude", "--advisor opus --add-dir '/a b'", BIN)).toEqual(["--advisor=opus", "--add-dir=/a b"]);
  expect(await checkFlags("codex", "--search", BIN)).toEqual(["--search"]);
  await expect(checkFlags("claude", "--model opus", BIN)).rejects.toThrow("--model can't be an extra flag");
  await expect(checkFlags("codex", "--advisor opus", BIN)).rejects.toThrow("Codex has no --advisor flag");
});

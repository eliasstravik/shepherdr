// Every program the service starts goes through here, so it lands in Shepherdr's own herdr-core session (session.ts).
// Bun.spawn and Bun.spawnSync without an `env` hand a child the environment the process started with, not
// process.env as changed since (Bun 1.4: useSession()'s HC_SESSION never reached a child, and every hc and
// herdr-task the service ran went to herdr-core's default session; SHEP-294). So each call here gives its child an
// explicit environment: the one asked for (default: process.env now) with HC_SESSION set to the session (unset when
// SHEPHERDR_SESSION is empty: herdr-core's default). test/test_repo.py refuses a Bun.spawn elsewhere in service/.
import { SESSION } from "./session.ts";

type Env = Record<string, string | undefined>;

/** A child's environment: env (default: process.env as it is now) in Shepherdr's session. */
export function childEnv(env: Env = process.env, session: string = SESSION): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined) out[k] = v;
  if (session) out.HC_SESSION = session;
  else delete out.HC_SESSION;
  return out;
}

/** Bun.spawn in Shepherdr's session (options.env: the whole environment, as Bun's; default process.env now). */
export function spawn<
  const In extends Bun.SpawnOptions.Writable = "ignore",
  const Out extends Bun.SpawnOptions.Readable = "pipe",
  const Err extends Bun.SpawnOptions.Readable = "inherit",
>(cmd: string[], options: Bun.SpawnOptions.SpawnOptions<In, Out, Err> = {}): Bun.Subprocess<In, Out, Err> {
  return Bun.spawn(cmd, { ...options, env: childEnv(options.env) });
}

/** Bun.spawnSync in Shepherdr's session, as spawn. */
export function spawnSync<
  const In extends Bun.SpawnOptions.Writable = "ignore",
  const Out extends Bun.SpawnOptions.Readable = "pipe",
  const Err extends Bun.SpawnOptions.Readable = "pipe",
>(cmd: string[], options: Bun.SpawnOptions.SpawnSyncOptions<In, Out, Err> = {}): Bun.SyncSubprocess<Out, Err> {
  return Bun.spawnSync(cmd, { ...options, env: childEnv(options.env) });
}

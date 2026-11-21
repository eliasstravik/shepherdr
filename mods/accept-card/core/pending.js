// A task action on another machine that was still running when herdr-task answered (SHEP-227, GitHub #1055,
// #1016): `herdr-task --on <m> <action>` runs it there whole even when the link drops, and answers within 25 s
// (the window stops a command at 30 s). Still running then, it exits PENDING with {error, pending: job, machine};
// this asks `herdr-task --on <m> _job <job>` again (each waits up to 25 s more) until the real result is in.
// The window runs an action here the same way (#1211: an Accept waiting on GitHub's merge outlasted 30 s):
// `herdr-task --detach <action>`, PENDING with machine "", followed with `herdr-task _job <job>`.
// detach(args): those args with --detach first when the action runs here.
// run(args) runs herdr-task with those args and resolves {code, stdout, stderr}.

export const PENDING = 75;
const ROUNDS = 6; // about three minutes in all, then its last words: still running there

function pendingJob(r) {
  if (r?.code !== PENDING) return null;
  try {
    const out = JSON.parse(r.stdout || "null");
    // machine "": an action here run as its own job (`herdr-task --detach`, #1211)
    return out?.pending && typeof out.machine === "string" ? out : null;
  } catch {
    return null;
  }
}

export async function settle(run, r, rounds = ROUNDS) {
  for (let i = 0; i < rounds; i++) {
    const p = pendingJob(r);
    if (!p) return r;
    r = await Promise.resolve()
      .then(() => run([...(p.machine ? ["--on", p.machine] : []), "_job", p.pending, "--json"]))
      .catch((e) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
  }
  return r;
}

export const detach = (args) => (args[0] === "--on" ? args : ["--detach", ...args]);

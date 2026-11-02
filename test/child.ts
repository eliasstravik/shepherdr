// A command a test's fake core runs, in its own child: async, so a slow child never blocks the test file's process.
// Bun.spawnSync with a buffer for stdin hung now and then on GitHub's runners (bun 1.4.2, bun test --parallel): the
// child sat there until the test timed out, and then the next one hung too (SHEP-48). This one always ends its child.
const DEADLINE = 15_000

/** stdout of argv run to its end, or an error with its stderr; a child still running at the deadline is killed */
export async function runChild(argv: string[], options: { cwd?: string; env?: Record<string, string | undefined>; input?: Uint8Array } = {}) {
  const child = Bun.spawn(argv, { cwd: options.cwd, env: options.env, stdin: options.input ?? 'ignore', stdout: 'pipe', stderr: 'pipe' })
  let timer: Timer | undefined
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Hung for ${DEADLINE / 1000} s, killed: ${argv.join(' ').slice(0, 200)}`)) }, DEADLINE) })
  try {
    const [stdout, stderr, code] = await Promise.race([Promise.all([new Response(child.stdout).arrayBuffer(), new Response(child.stderr).text(), child.exited]), deadline])
    if (code !== 0) throw new Error(stderr)
    return Buffer.from(stdout)
  } finally { clearTimeout(timer); if (child.exitCode === null && !child.killed) child.kill('SIGKILL'); await child.exited }
}

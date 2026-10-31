#!/usr/bin/env bun
// OUTSIDE containment. macOS has no PID namespace, so nothing ends a process tree for us: a detached daemon leaves its
// session and parent. Its Seatbelt profile cannot be left, though, and the kernel answers for any same-user PID what
// that profile allows. Two host-owned marker files, one only this profile may read, name its processes exactly.
import { dlopen, FFIType, ptr } from 'bun:ffi'
import { lstatSync, rmSync } from 'node:fs'

export interface PilotMacMarker { allowed: string; denied: string }
let native: { sandboxed(pid: number): number; check(pid: number, operation: Buffer, path: Buffer): number; list(buffer: Int32Array): number } | undefined
function libc() {
  if (native) return native
  const FILTER_PATH = 1, NO_REPORT = 0x40000000
  const { i32, i64, ptr: pointer } = FFIType
  // sandbox_check is variadic. arm64 macOS passes variadic arguments on the stack, so the path goes ninth, past the
  // eight argument registers; x86-64 passes them in registers like any other argument.
  const arm = process.arch === 'arm64'
  const { symbols } = dlopen('/usr/lib/libSystem.B.dylib', {
    sandbox_check: arm ? { args: [i32, pointer, i32, i64, i64, i64, i64, i64, pointer], returns: i32 } : { args: [i32, pointer, i32, pointer], returns: i32 },
    proc_listallpids: { args: [pointer, i32], returns: i32 },
  })
  // Without an operation it answers only whether the process has any sandbox at all.
  const plain = dlopen('/usr/lib/libSystem.B.dylib', { sandbox_check: { args: [i32, FFIType.u64, i32], returns: i32 } }).symbols.sandbox_check as unknown as (pid: number, operation: bigint, type: number) => number
  const sandboxCheck = symbols.sandbox_check as unknown as (...args: unknown[]) => number
  const listPids = symbols.proc_listallpids as unknown as (...args: unknown[]) => number
  native = {
    sandboxed: pid => plain(pid, 0n, 0),
    check: (pid, operation, path) => arm ? sandboxCheck(pid, ptr(operation), FILTER_PATH | NO_REPORT, 0, 0, 0, 0, 0, ptr(path)) : sandboxCheck(pid, ptr(operation), FILTER_PATH | NO_REPORT, ptr(path)),
    list: buffer => listPids(ptr(buffer), buffer.byteLength),
  }
  return native
}
/** Every live process in this exact profile. An unsandboxed process may read both markers; any other profile, neither. */
export function pilotMacProcesses(marker: PilotMacMarker, matched?: (pid: number) => void) {
  // The kernel calls a missing path denied for everyone, so a lost marker would make every process look like ours.
  // This result decides what gets SIGKILL: prove the markers first, and only ever match a sandboxed process.
  for (const path of [marker.allowed, marker.denied]) if (typeof path !== 'string' || !path.startsWith('/') || !lstatSync(path).isFile()) throw Error('Invalid sandbox marker')
  const { sandboxed, check, list } = libc(), operation = Buffer.from('file-read-data\0'), allowed = Buffer.from(marker.allowed + '\0'), denied = Buffer.from(marker.denied + '\0')
  if (sandboxed(process.pid) !== 0 || check(process.pid, operation, allowed) !== 0 || check(process.pid, operation, denied) !== 0) throw Error('The sandbox markers cannot be trusted here')
  const pids = new Int32Array(65536), count = list(pids)
  if (count < 0) throw Error('The process list could not be read')
  return [...pids.subarray(0, count)].filter(pid => {
    if (!(pid > 1 && pid !== process.pid && sandboxed(pid) === 1 && check(pid, operation, allowed) === 0 && check(pid, operation, denied) === 1)) return false
    matched?.(pid)
    return true
  })
}
/** Kill until repeated full passes find nothing, so a fork between passes is still caught. False means some remain. */
export async function pilotMacSweep(marker: PilotMacMarker, deadline = Date.now() + 60_000) {
  let clean = 0
  while (clean < 3) {
    // Kill as each one matches: a process that keeps forking has moved on by the end of a pass.
    const found = pilotMacProcesses(marker, pid => { try { process.kill(pid, 'SIGKILL') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error } })
    if (found.length) {
      clean = 0
      if (Date.now() > deadline) return false
    } else clean++
    await Bun.sleep(found.length ? 5 : 20)
  }
  return true
}

/** Whether a sweep sees a process just started, so one finding nothing can be believed. One already gone needs no stopping. */
export async function pilotMacVisible(marker: PilotMacMarker, child: { pid: number; exitCode: number | null; signalCode: string | number | null }, wait = 5000) {
  const running = () => child.exitCode === null && child.signalCode === null, end = Date.now() + wait
  while (running() && Date.now() < end) {
    if (pilotMacProcesses(marker).includes(child.pid)) return true
    await Bun.sleep(10)
  }
  return !running()
}

// One per runtime, in its own session. The owner holds this stdin open, so even its SIGKILL ends here as EOF. A
// sandboxed process cannot signal it: the profile allows signals only inside the same sandbox.
if (import.meta.main) {
  const [allowed, denied, end, login] = process.argv.slice(2)
  if (!allowed?.startsWith('/') || !denied?.startsWith('/')) throw Error('Invalid sandbox marker')
  const marker = { allowed, denied }, deadline = Number(end)
  let timer: ReturnType<typeof setTimeout> | undefined
  if (deadline > 0) {
    // macOS ships no coreutils timeout. This independent process enforces the run's absolute deadline instead.
    timer = setTimeout(() => { void pilotMacSweep(marker).catch(() => {}) }, Math.max(1, Math.min(deadline - Date.now(), 2 ** 31 - 1)))
  }
  for await (const _ of process.stdin) { /* Only EOF means anything here. */ }
  if (timer) clearTimeout(timer)
  // One still dodging is out of the gateway, but can still write its worktree, so this keeps trying long after the owner gave up.
  const giveUp = Date.now() + 3_600_000
  let clean = false
  // A refused sweep can't improve by retrying: it killed nothing, and the owner reports the exit.
  try { while (!clean && Date.now() < giveUp) clean = await pilotMacSweep(marker) } catch { clean = false }
  // The owner normally does this, but it may have been killed. The run is over, so this token has no reader.
  if (login?.startsWith('/')) rmSync(login, { force: true })
  process.exit(clean ? 0 : 1)
}

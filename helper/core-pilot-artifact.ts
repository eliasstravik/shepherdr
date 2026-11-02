#!/usr/bin/env bun
// OUTSIDE the agent. Only bounded artifact files cross this broker; reads run in a fresh read-only namespace.
import { closeSync, constants, lstatSync, mkdirSync, openSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

export interface PilotArtifactInput {
  op: 'read' | 'export'; captures: string; repo: string; cwd: string
  path?: string; max?: number; name?: string; data?: string
}
function privateDirectory(path: string) {
  const s = lstatSync(path)
  if (!s.isDirectory() || s.isSymbolicLink() || s.mode & 0o077 || process.getuid && s.uid !== process.getuid() || realpathSync(path) !== resolve(path)) throw Error('Artifact runtime directory is not private and real')
}
export async function pilotArtifact(input: PilotArtifactInput) {
  const root = dirname(input.captures), control = join(root, 'control'), exports = join(control, 'artifacts')
  if (basename(input.captures) !== 'captures' || !/^pilot-[A-Za-z0-9]+$/.test(basename(root))) throw Error('Invalid private artifact runtime')
  privateDirectory(root); privateDirectory(control)
  try { mkdirSync(exports, { mode: 0o700 }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  privateDirectory(exports)
  if (input.op === 'export') {
    if (typeof input.data !== 'string' || input.data.length > 4 * 1024 * 1024) throw Error('Invalid bounded artifact export')
    const bytes = Buffer.from(input.data, 'base64')
    if (bytes.toString('base64') !== input.data) throw Error('Invalid artifact export encoding')
    if (bytes.length > 2 * 1024 * 1024) throw Error('Artifact export is over 2 MiB')
    const name = `${randomBytes(8).toString('hex')}-${basename(input.name || 'artifact').replace(/[^A-Za-z0-9._-]/g, '_').slice(-120)}`
    const fd = openSync(join(exports, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try { writeFileSync(fd, bytes) } finally { closeSync(fd) }
    return `/run/shepherdr/artifacts/${name}`
  }
  if (input.op !== 'read' || typeof input.path !== 'string' || input.path.length > 4096 || !Number.isSafeInteger(input.max) || input.max! < 1 || input.max! > 2 * 1024 * 1024) throw Error('Invalid bounded artifact input')
  const repo = realpathSync(input.repo), cwd = realpathSync(input.cwd)
  if (repo !== resolve(input.repo) || cwd !== resolve(input.cwd) || repo === '/' || cwd === '/') throw Error('Artifact projects need real directories')
  const within = (a: string, b: string) => a === b || a.startsWith(b + '/')
  for (const project of [repo, cwd]) if (within(root, project) || within(project, root)) throw Error('Artifact project overlaps private runtime state')
  const bwrap = Bun.which('bwrap')
  if (!bwrap) throw Error('Contained artifact reads require bubblewrap; no host read fallback')
  const args = ['--die-with-parent', '--new-session', '--unshare-all', '--cap-drop', 'ALL', '--clearenv']
  for (const path of ['/usr', '/bin', '/lib', '/lib64']) { try { lstatSync(path); args.push('--ro-bind', path, path) } catch {} }
  args.push('--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--dir', '/run/shepherdr', '--ro-bind', realpathSync(process.execPath), '/run/shepherdr/bun', '--ro-bind', exports, '/run/shepherdr/artifacts')
  args.push('--ro-bind', repo, repo)
  if (cwd !== repo) args.push('--ro-bind', cwd, cwd)
  const script = `const f=require('node:fs'),p=require('node:path'),x=JSON.parse(process.argv[1]);const file=f.realpathSync(p.resolve(x.cwd,x.path)),inside=(r)=>file===r||file.startsWith(r+'/');if(![x.repo,x.cwd,'/run/shepherdr/artifacts'].some(inside))throw Error('Artifact file is outside the contained project and exports');const fd=f.openSync(file,f.constants.O_RDONLY|f.constants.O_NONBLOCK|f.constants.O_NOFOLLOW);try{const s=f.fstatSync(fd);if(!s.isFile()||s.nlink!==1||s.size>x.max)throw Error('Artifact file must be a regular unshared bounded file');const b=Buffer.alloc(x.max+1);let n=0;while(n<b.length){const k=f.readSync(fd,b,n,b.length-n,null);if(!k)break;n+=k}if(n>x.max)throw Error('Artifact file grew past its limit');process.stdout.write(b.subarray(0,n).toString('base64'))}finally{f.closeSync(fd)}`
  // Never launch Bun from the mutable project: its bunfig preloads are agent code.
  args.push('--chdir', '/run/shepherdr', '/run/shepherdr/bun', '-e', script, JSON.stringify({ repo, cwd, path: input.path, max: input.max }))
  const child = Bun.spawn([realpathSync(bwrap), ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env: {}, timeout: 5000 })
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (code !== 0) throw Error(err.slice(-2000) || 'Contained artifact read failed')
  if (out.length > Math.ceil(input.max! / 3) * 4) throw Error('Contained artifact response exceeded its limit')
  return out
}
if (import.meta.main) {
  try {
    const chunks: Buffer[] = []; let size = 0
    for await (const part of process.stdin) { const b = Buffer.from(part); size += b.length; if (size > 4 * 1024 * 1024) throw Error('Artifact broker input is too large'); chunks.push(b) }
    process.stdout.write(await pilotArtifact(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
  } catch (error) { console.error((error as Error).message); process.exitCode = 1 }
}

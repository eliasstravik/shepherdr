import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { CORE_VERSION } from './protocol.ts'
import type { CoreFiles } from './files.ts'
import { CORE_ENVIRONMENT, type CoreEnvironment, type CoreEndpoint } from './client.ts'

export interface RemoteRuntime { root: string; home: string; bun: string; hc: string; path: string; session?: string; socket?: string; environment?: CoreEnvironment; endpoint: CoreEndpoint; browser: string }
const PARTS = ['helper/core-worktree-includes.ts', 'helper/core-worktree-move.ts', 'helper/core-cli.ts', 'helper/core-hook.ts', 'helper/core-review.ts', 'helper/core-secret.ts', 'helper/core-browser.ts', 'helper/core-browser-session.ts', 'server/browser-pick.ts', 'shared/browser.ts', 'server/core/browser-protocol.ts', 'server/core/home.ts', 'server/core/client.ts', 'server/core/protocol.ts', 'server/core/envelope.ts', 'server/core/mailbox.ts', 'server/core/request.ts']
PARTS.push(...['artifact', 'inventory', 'native', 'path', 'ssh', 'git', 'backend', 'bootstrap', 'capture', 'cli', 'gateway', 'home', 'hook', 'launch', 'proxy', 'records', 'runtime', 'sandbox', 'tls', 'mac', 'mac-login', 'mac-stop', 'statusline'].map(name => `helper/core-pilot-${name}.ts`))
const quote = (text: string) => `'${text.replace(/'/g, `'"'"'`)}'`

/** Provision only private agent helper files through core exec. No SSH client, listener, worker or service. */
export class CoreRemotes {
  private preparing = new Map<string, Promise<RemoteRuntime>>()
  constructor(private readonly files: CoreFiles, private readonly installation: string,
    private readonly profile: (machine: string) => { session?: string | null; version?: string }) {}
  async bun(machine: string) {
    const find = `command -v bun || { test -x "$HOME/.bun/bin/bun" && printf '%s\\n' "$HOME/.bun/bin/bun"; }`
    const bun = (await this.files.exec(machine, ['sh', '-c', find])).toString('utf8').trim()
    if (!bun || bun.includes('\n')) throw new Error('Install Bun on this machine before starting a Shepherdr agent')
    return bun
  }
  async prepare(machine: string): Promise<RemoteRuntime> {
    const running = this.preparing.get(machine)
    if (running) return running
    const promise = this.prepareNow(machine)
    this.preparing.set(machine, promise)
    try { return await promise } finally { this.preparing.delete(machine) }
  }
  private async prepareNow(machine: string): Promise<RemoteRuntime> {
    const profile = this.profile(machine)
    if (profile.version !== CORE_VERSION) throw new Error(`This machine must run core ${CORE_VERSION}; no binary or service was changed`)
    const bun = await this.bun(machine)
    const metadata = JSON.parse((await this.files.exec(machine, [bun, '-e', `const o=require('node:os'),f=require('node:fs');const hc=Bun.which('hc');if(!hc)throw Error('hc is missing from this core environment');const v=Bun.spawnSync([hc,'--version']);if(v.exitCode)throw Error('hc version failed');console.log(JSON.stringify({home:f.realpathSync(o.homedir()),bun:process.execPath,hc,path:process.env.PATH||'',version:v.stdout.toString().trim(),session:process.env.HC_SESSION,socket:process.env.HC_SOCKET,environment:Object.fromEntries(${JSON.stringify(CORE_ENVIRONMENT)}.map(k=>[k,process.env[k]??null])),platform:process.platform,arch:process.arch,musl:process.platform==='linux'&&(()=>{const p=Bun.spawnSync(['ldd','--version']);return /musl/i.test(p.stdout.toString()+p.stderr.toString())})()}))`])).toString('utf8')) as { home: string; bun: string; hc: string; path: string; version: string; session?: string; socket?: string; environment?: CoreEnvironment; platform: string; arch: string; musl: boolean }
    if (!metadata.version.endsWith(` ${CORE_VERSION}`) && metadata.version !== CORE_VERSION) throw new Error(`Remote hc must be pinned to ${CORE_VERSION}; nothing was installed`)
    const source = join(import.meta.dir, '../..')
    const parts = Object.fromEntries(PARTS.map(path => [path, readFileSync(join(source, path), 'utf8')]))
    const packageRoot = join(source, 'node_modules/agent-browser')
    const browserVersion = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version
    if (browserVersion !== '0.39.4') throw new Error('Shepherdr requires its pinned agent-browser 0.39.4')
    if (!['linux', 'darwin'].includes(metadata.platform) || !['x64', 'arm64'].includes(metadata.arch)) throw new Error('This browser platform is not supported')
    const binaryName = `agent-browser-${metadata.platform}${metadata.musl ? '-musl' : ''}-${metadata.arch}`
    const browserBytes = readFileSync(join(packageRoot, 'bin', binaryName))
    const browserHash = createHash('sha256').update(browserBytes).digest('hex')
    parts['vendor/agent-browser/package.json'] = JSON.stringify({ name: 'agent-browser', version: browserVersion, binaryHash: browserHash })
    const assets = (directory: string) => {
      for (const item of readdirSync(join(packageRoot, directory), { withFileTypes: true })) {
        const name = join(directory, item.name)
        if (item.isDirectory()) assets(name)
        else if (item.isFile()) parts['vendor/agent-browser/' + name] = readFileSync(join(packageRoot, name), 'utf8')
      }
    }
    assets('skills'); assets('skill-data')
    parts['bin/agent-browser'] = readFileSync(join(source, 'bin/agent-browser'), 'utf8').replace('node_modules/agent-browser/bin/', 'vendor/agent-browser/bin/')
    parts['vendor/agent-browser/LICENSE'] = readFileSync(join(packageRoot, 'LICENSE'), 'utf8')
    // bin/shepherdr below names this Bun, and a helper folder is never rewritten: a new Bun path needs its own folder.
    const digest = createHash('sha256').update(JSON.stringify({ parts, bun: metadata.bun })).digest('hex').slice(0, 24)
    const root = join(metadata.home, '.local/share/shepherdr-agents', this.installation, digest)
    parts['bin/shepherdr'] = `#!/bin/sh\nexec ${quote(metadata.bun)} ${quote(join(root, 'helper/core-cli.ts'))} "$@"\n`

    const script = `const f=require('node:fs'),p=require('node:path');const x=JSON.parse(await Bun.stdin.text());const ensure=d=>{f.mkdirSync(d,{recursive:true,mode:0o700});const s=f.lstatSync(d);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077)||f.realpathSync(d)!==d)throw Error('Agent runtime must be a private real directory')};ensure(x.root);for(const [name,text]of Object.entries(x.parts)){if(name.includes('..')||p.isAbsolute(name))throw Error('Bad helper path');const file=p.join(x.root,name);ensure(p.dirname(file));if(f.existsSync(file)){const s=f.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077)||f.readFileSync(file,'utf8')!==text)throw Error('Existing helper differs; left untouched')}else f.writeFileSync(file,text,{mode:name.startsWith('bin/')?0o700:0o600,flag:'wx'})}console.log('provisioned')`
    await this.files.exec(machine, [metadata.bun, '-e', script], undefined, Buffer.from(JSON.stringify({ root, parts })))
    await this.binary(machine, metadata.bun, root, join(root, 'vendor/agent-browser/bin', binaryName), browserBytes, browserHash)
    const session = profile.session ?? metadata.session
    const endpoint = { binary: metadata.hc, session, socket: metadata.socket, environment: metadata.environment }
    const check = `const {CoreClient}=await import(${JSON.stringify(join(root, 'server/core/client.ts'))});const c=await CoreClient.endpoint(${JSON.stringify(endpoint)});try{const s=await c.call('server.status');if(s.core.id!==${JSON.stringify(machine)})throw Error('Remote helper reached a different core identity');console.log('identity verified')}finally{c.close()}`
    await this.files.exec(machine, [metadata.bun, '-e', check])
    return { ...metadata, root, session, endpoint, browser: join(root, 'bin/agent-browser') }
  }
  private async binary(machine: string, bun: string, root: string, path: string, bytes: Buffer, hash: string) {
    const script = `const f=require('node:fs'),p=require('node:path'),c=require('node:crypto'),x=JSON.parse(await Bun.stdin.text());const check=file=>{const s=f.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==process.getuid()||(s.mode&0o077)||!(s.mode&0o100)||c.createHash('sha256').update(f.readFileSync(file)).digest('hex')!==x.hash)throw Error('Pinned browser runtime differs; left untouched')};if(x.op==='check'){if(!f.existsSync(x.path)){process.stdout.write('missing')}else{check(x.path);process.stdout.write('present')}}else{const dir=p.dirname(x.path);f.mkdirSync(dir,{recursive:true,mode:0o700});const d=f.lstatSync(dir);if(!d.isDirectory()||d.isSymbolicLink()||d.uid!==process.getuid()||(d.mode&0o077)||f.realpathSync(dir)!==dir)throw Error('Browser runtime directory must be private');if(x.op==='chunk'){const fd=f.openSync(x.temp,(x.offset?f.constants.O_WRONLY:f.constants.O_WRONLY|f.constants.O_CREAT|f.constants.O_EXCL)|f.constants.O_NOFOLLOW,0o700);try{const s=f.fstatSync(fd);if(!s.isFile()||s.nlink!==1||s.size!==x.offset||s.uid!==process.getuid()||(s.mode&0o077))throw Error('Browser upload changed');const b=Buffer.from(x.data,'base64');let n=0;while(n<b.length)n+=f.writeSync(fd,b,n,b.length-n,x.offset+n)}finally{f.closeSync(fd)}}else{check(x.temp);try{f.linkSync(x.temp,x.path)}catch(e){if(e.code!=='EEXIST')throw e;check(x.path)}finally{f.unlinkSync(x.temp)}}}`
    const run = (input: object) => this.files.exec(machine, [bun, '-e', script], undefined, Buffer.from(JSON.stringify({ path, hash, ...input })))
    if ((await run({ op: 'check' })).toString() === 'present') return
    const temp = join(root, 'vendor/agent-browser/bin', `.upload-${randomUUID()}`)
    try {
      for (let offset = 0; offset < bytes.length; offset += 2 * 1024 * 1024) await run({ op: 'chunk', temp, offset, data: bytes.subarray(offset, offset + 2 * 1024 * 1024).toString('base64') })
      await run({ op: 'finish', temp })
    } finally { await this.files.exec(machine, ['rm', '-f', temp]).catch(() => {}) }
  }
  async privateFile(machine: string, runtime: RemoteRuntime, path: string, text: string) {
    if (!path.startsWith(runtime.root + '/sessions/')) throw new Error('Private launch file is outside its runtime')
    const script = `const f=require('node:fs'),p=require('node:path');const name=process.argv.at(-1),dir=p.dirname(name);f.mkdirSync(dir,{recursive:true,mode:0o700});const s=f.lstatSync(dir);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077)||f.realpathSync(dir)!==dir)throw Error('Launch directory is not private');f.writeFileSync(name,await Bun.stdin.text(),{mode:0o600,flag:'wx'})`
    await this.files.exec(machine, [runtime.bun, '-e', script, '--', path], undefined, Buffer.from(text))
  }
}

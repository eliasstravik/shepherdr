import { tag as chatTag } from '../common/chatlines.ts'
import { age } from '../common/age.ts'
import { randomBytes } from 'node:crypto'
import { dirname, join, basename } from 'node:path'
import { readFileSync } from 'node:fs'
import { artifactChecker, taskArtifactTitle, titleCase, type Checker, type CheckResult } from '../artifact-check.ts'
import { wrapPage } from '../frame.ts'
import { one, parseArgs } from '../common/args.ts'
import { browserNamespace } from './browser-id.ts'
import { Refusal } from './client.ts'
import { coreSpaceName, findCoreSpace } from './space-names.ts'
import type { CoreSource } from './source.ts'
import type { CoreAgent } from './model.ts'
import type { Action, Artifact } from '../../shared/types.ts'

interface Version { n: number; at: number; by: string; chat: string; note?: string; html: number; data?: number; what?: 'data' | 'title' }
interface Record { id: string; title: string; place: string; at: number; maker?: string; versions: Version[]; sent?: { html: number; text: string }; thumb?: boolean }

const IMAGE_TYPES: { [ext: string]: string } = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif' }

/** Artifacts belong to the app; every input on any machine is read only through core. */
export class CoreArtifacts {
  checker: Checker
  private updating = new Set<string>()
  constructor(private source: CoreSource, private installation: string) {
    this.checker = artifactChecker(source.config.home, async args => {
      try {
        const home = source.spaces().find(space => space.home && space.machine === source.localMachineId())
        if (!home) throw new Error('The local core is not connected')
        const install = this.installation
        const argv = [join(import.meta.dir, '../../bin/agent-browser'), ...args]
        const env = { AGENT_BROWSER_NAMESPACE: browserNamespace(install), AGENT_BROWSER_SESSION: 'artifacts', AGENT_BROWSER_PROFILE: join(source.config.home, 'browser/artifacts'), SHEPHERDR_OWN: '1' }
        const script = `const x=JSON.parse(await Bun.stdin.text()),env={...process.env};for(const key of Object.keys(env))if(key.startsWith('AGENT_BROWSER_')||key.startsWith('SHEPHERDR_'))delete env[key];Object.assign(env,x.env);const child=Bun.spawn(x.argv,{env,stdin:'ignore',stdout:'inherit',stderr:'inherit'});process.exitCode=await child.exited`
        const bytes = await source.files.exec(home.machine, [process.execPath, '-e', script], source.config.home, Buffer.from(JSON.stringify({ argv, env })), 45)
        return { ok: true, out: bytes.toString('utf8'), err: '' }
      } catch (error) { return { ok: false, out: '', err: (error as Error).message } }
    }, (html, data) => wrapPage(html, { check: true, phone: true, data }), 'a')
  }
  private get(id: string) { const artifact = this.source.store.get<Record>('core-artifact', id); if (!artifact) throw new Refusal('No such artifact'); return artifact }
  private version(artifact: Record, n?: number) { const version = n ? artifact.versions.find(version => version.n === n) : artifact.versions.at(-1); if (!version) throw new Refusal('No such artifact version'); return version }
  private save(artifact: Record) { this.source.store.set('core-artifact', artifact.id, artifact); this.source.emit('snapshot') }
  private keeper(artifact: Record) {
    const chat = artifact.versions.at(-1)!.chat, task = this.source.tasks.forChat(chat)
    return task && ['merged', 'closed'].includes(task.workflow) ? artifact.place : this.source.agents.get(chat) ? chat : artifact.place
  }
  private name(chat: string) {
    const task = this.source.tasks.forChat(chat)
    if (task) return `${task.id} ${chat.slice(chat.lastIndexOf('/') + 1).toLowerCase()}`
    const space = this.source.space(chat)
    return space ? coreSpaceName(this.source, space) : 'Coordinator'
  }
  /** the task an artifact is for is the one whose agent made it, whoever retitles it later; a coordinator's stays as
   *  written. The limit is on what the title's writer adds: a task's id and name never count against it */
  private titled(title: string, chat: string) {
    const task = this.source.tasks.forChat(chat)
    const named = task ? taskArtifactTitle(title, task) : titleCase(title), given = task ? taskArtifactTitle('', task).length + 3 : 0
    if (named.length - given > 200) throw new Refusal('Keep the title under 200 characters')
    return named
  }
  list(): Artifact[] {
    return this.source.store.all<Record>('core-artifact').map(artifact => ({ id: artifact.id, title: artifact.title, place: artifact.place, at: artifact.at,
      v: artifact.versions.at(-1)!.n, when: age(artifact.at), by: artifact.versions.at(-1)!.by, keeper: this.name(this.keeper(artifact)), thumb: artifact.thumb,
      chats: [...new Set(artifact.versions.map(version => version.chat))], versions: [...artifact.versions].reverse().map(version => ({ n: version.n, when: age(version.at), by: version.by, note: version.note, html: version.html, what: version.what })) }))
  }
  /** the newest proof a task's agent made */
  proof(chat: string) {
    const artifact = this.source.store.all<Record>('core-artifact').filter(artifact => /\bproof\b/i.test(artifact.title) && artifact.versions.some(version => version.chat === chat)).sort((a, b) => b.at - a.at)[0]
    return artifact && { id: artifact.id, title: artifact.title }
  }
  page(id: string, n?: number) {
    const artifact = this.get(id), version = this.version(artifact, n)
    return { html: this.source.store.get<string>('artifact-html', `${id}:${version.html}`)!, data: version.data ? this.source.store.get<unknown>('artifact-data', `${id}:${version.data}`) : undefined,
      sent: artifact.sent?.html === version.html ? artifact.sent.text : undefined }
  }
  thumb(id: string, dark: boolean) { this.get(id); const data = this.source.store.get<string>('artifact-thumb', `${id}:${dark ? 'dark' : 'light'}`); return data ? new Blob([Buffer.from(data, 'base64')], { type: 'image/png' }) : null }

  private async read(agent: CoreAgent, path: string, cwd: string, max: number, image = false): Promise<Buffer> {
    if (agent.pilot) return Buffer.from(await this.contained(agent, { op: 'read', path, max }), 'base64')
    const bun = await this.source.agents.bun(agent.machine)
    const script = `const f=require('node:fs'),p=require('node:path'),o=require('node:os'),x=JSON.parse(await Bun.stdin.text());const file=f.realpathSync(p.resolve(x.cwd,x.path));const within=(file,root)=>file===root||file.startsWith(root+p.sep);for(let root of [x.home,p.join(o.homedir(),'.shepherdr'),p.join(o.homedir(),'.shepherdr-legacy'),p.join(o.homedir(),'.local/share/shepherdr-agents'),p.join(o.homedir(),'.codex'),p.join(o.homedir(),'.claude'),p.join(o.homedir(),'.ssh')]){try{root=f.realpathSync(root)}catch{}if(within(file,root)&&!(root===x.home&&['inbox','uploads','artifacts',...(x.image?['checks']:[])].some(dir=>within(file,p.join(root,dir)))))throw Error('Private files cannot be imported into artifacts')};const fd=f.openSync(file,f.constants.O_RDONLY|f.constants.O_NOFOLLOW);try{const s=f.fstatSync(fd);if(!s.isFile()||s.nlink>1||s.size>x.max)throw Error('Artifact input is not a regular file under the size limit');const b=f.readFileSync(fd);if(b.length>x.max)throw Error('Artifact input grew past its size limit');process.stdout.write(b.toString('base64'))}finally{f.closeSync(fd)}`
    return Buffer.from((await this.source.files.exec(agent.machine, [bun, '-e', script], undefined, Buffer.from(JSON.stringify({ path, cwd, max, image, home: this.source.config.home })))).toString('utf8'), 'base64')
  }
  private async inputs(agent: CoreAgent, file: string | undefined, dataFile: string | undefined, cwd: string) {
    let html: string | undefined, data: unknown, hasData = false
    const missing: string[] = []
    if (file) {
      html = new TextDecoder('utf-8', { fatal: true }).decode(await this.read(agent, file, cwd, 2 * 1024 * 1024))
      if (!html.trim()) throw new Refusal('The HTML file is empty')
      const pattern = /(["'(])(\/[^"'()\s<>]{1,1024}?\.(png|jpe?g|gif|webp|svg|avif))(?=["')])/gi
      const matches = [...html.matchAll(pattern)]
      const paths = [...new Map(matches.map(match => [match[2], match[3].toLowerCase()])).entries()]
      if (paths.length > 128) throw new Refusal('Use at most 128 embedded pictures in one artifact')
      const embedded = new Map<string, string>()
      let total = Buffer.byteLength(html)
      for (const [path, ext] of paths) {
        try {
          const bytes = await this.read(agent, path, cwd, 1024 * 1024, true), head = bytes.subarray(0, 12).toString('latin1')
          const valid = ext === 'svg' ? /<svg[\s>]/i.test(bytes.subarray(0, 4096).toString('utf8')) : head.startsWith('\x89PNG') || head.startsWith('\xff\xd8\xff') || head.startsWith('GIF8') || head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP' || /^ftyp(avif|avis|mif1)$/.test(head.slice(4, 12))
          if (!valid) throw new Error('Not an image')
          const value = `data:${IMAGE_TYPES[ext]};base64,${bytes.toString('base64')}`
          total += (Buffer.byteLength(value) - Buffer.byteLength(path)) * matches.filter(match => match[2] === path).length
          if (total > 2 * 1024 * 1024) throw new Refusal('The HTML is over 2 MiB with its pictures inlined')
          embedded.set(path, value)
        } catch (error) { if (error instanceof Refusal) throw error; missing.push(path) }
      }
      html = html.replace(pattern, (all, open: string, path: string) => embedded.has(path) ? open + embedded.get(path) : all)
      if (Buffer.byteLength(html) > 2 * 1024 * 1024) throw new Refusal('The HTML is over 2 MiB with its pictures inlined')
    }
    if (dataFile) {
      try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await this.read(agent, dataFile, cwd, 1024 * 1024))); hasData = true }
      catch { throw new Refusal('The data file must contain valid UTF-8 JSON under 1 MiB') }
    }
    return { html, data, hasData, missing }
  }
  private async check(html: string, data: unknown, missing: string[]) {
    const result = await this.checker(html, data)
    const errors = [...missing.map(path => `Missing or invalid picture: ${path}`), ...result.errors]
    if (result.skipped || !result.shots) throw new Refusal('The artifact could not be checked in a browser. Nothing was published. ' + (result.skipped || 'No screenshots were produced'))
    if (errors.length) throw new Refusal('Not published; fix these problems:\n' + errors.join('\n'))
    return result
  }
  private async export(agent: CoreAgent, name: string, bytes: Uint8Array) {
    if (agent.pilot) return this.contained(agent, { op: 'export', name, data: Buffer.from(bytes).toString('base64') })
    const bun = await this.source.agents.bun(agent.machine)
    const script = `const f=require('node:fs'),p=require('node:path'),o=require('node:os'),x=JSON.parse(await Bun.stdin.text());const dir=p.join(o.homedir(),'.cache/shepherdr-artifacts',x.id);f.mkdirSync(dir,{recursive:true,mode:0o700});const s=f.lstatSync(dir);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077)||s.uid!==process.getuid()||f.realpathSync(dir)!==dir)throw Error('Artifact exports need a private real directory');const file=p.join(dir,x.name);f.writeFileSync(file,Buffer.from(x.data,'base64'),{mode:0o600,flag:'wx'});process.stdout.write(file)`
    const id = this.installation
    return (await this.source.files.exec(agent.machine, [bun, '-e', script], undefined, Buffer.from(JSON.stringify({ id, name: `${randomBytes(6).toString('hex')}-${basename(name)}`, data: Buffer.from(bytes).toString('base64') })))).toString('utf8')
  }
  private async contained(agent: CoreAgent, operation: { op: 'read'; path: string; max: number } | { op: 'export'; name: string; data: string }) {
    if (!agent.pilot) throw new Refusal('No contained artifact runtime')
    const run = this.source.pilots.policy.actor(agent.pilot.run, this.source.pilots.actor(agent))
    const space = this.source.space(run.place), task = this.source.tasks.forChat(agent.chat)
    if (!space || run.machine !== agent.machine || task && task.pilot !== run.id) throw new Refusal('This artifact runtime does not belong to this run')
    const runtime = await this.source.agents.browserRuntime(agent.machine)
    const out = await this.source.files.exec(agent.machine, [runtime.bun, join(runtime.root, 'helper/core-pilot-artifact.ts')], undefined,
      Buffer.from(JSON.stringify({ ...operation, captures: agent.pilot.captures, cwd: task?.folder ?? space.folder, repo: space.folder })))
    this.source.pilots.policy.actor(agent.pilot.run, this.source.pilots.actor(agent))
    return out.toString('utf8')
  }
  private async report(agent: CoreAgent, result: CheckResult) {
    const shots = result.shots!
    const light = await this.export(agent, basename(shots.light), readFileSync(shots.light)), dark = await this.export(agent, basename(shots.dark), readFileSync(shots.dark))
    return `No errors. Pictures at phone width: ${light} (dark: ${dark}). Look at them.${result.warnings.length ? '\nWarnings: ' + result.warnings.join(' · ') : ''}${result.media?.length ? '\nDoes not fit at phone width: ' + result.media.join(' · ') : ''}`
  }
  async cli(agent: CoreAgent, args: string[], cwd: string) {
    const [, verb, id] = parseArgs(args).words
    if (verb === 'update' && this.updating.has(id)) throw new Refusal('This artifact is being updated; try again after it finishes')
    if (verb === 'update') this.updating.add(id)
    try { return await this.command(agent, args, cwd) } finally { if (verb === 'update') this.updating.delete(id) }
  }
  private async command(agent: CoreAgent, args: string[], cwd: string) {
    const parsed = parseArgs(args), [, verb = 'list', id, file] = parsed.words
    const spaceFlag = one(parsed, 'space'), space = spaceFlag ? findCoreSpace(this.source, agent.machine, spaceFlag) : undefined
    if (spaceFlag && !space) throw new Refusal('No such space on this machine')
    if (agent.pilot && (space && space.id !== agent.space || ['show', 'update', 'rm', 'remove', 'delete'].includes(verb) && this.get(id).place !== agent.space)) throw new Refusal('This artifact belongs to another space')
    if (verb === 'list') return this.list().filter(artifact => (!space || artifact.place === space.id) && (!agent.pilot || artifact.place === agent.space)).map(artifact => `${artifact.id} v${artifact.v} ${artifact.title}`).join('\n') || 'No artifacts here yet.'
    if (verb === 'show') {
      const artifact = this.get(id), version = this.version(artifact), page = this.page(id)
      const html = await this.export(agent, `${id}-${version.n}-${randomBytes(3).toString('hex')}.html`, Buffer.from(page.html))
      const data = page.data === undefined ? undefined : await this.export(agent, `${id}-${version.n}-${randomBytes(3).toString('hex')}.json`, Buffer.from(JSON.stringify(page.data)))
      return `${id} “${artifact.title}” v${version.n}\nHTML: ${html}\nData: ${data || 'none'}\nVersions:\n${[...artifact.versions].reverse().map(version => `v${version.n} ${version.by}${version.note ? ' · ' + version.note : ''}`).join('\n')}`
    }
    if (agent.role === 'reviewer') throw new Refusal('Reviewers cannot publish artifacts')
    if (['rm', 'remove', 'delete'].includes(verb)) { await this.act({ type: 'artifact-delete', place: this.get(id).place, artifact: id }); return 'Artifact removed' }
    if (!['new', 'update', 'check'].includes(verb)) throw new Refusal('Use artifact new, update, check, show, list or remove')
    const previous = verb === 'update' ? this.get(id) : undefined
    const input = await this.inputs(agent, verb === 'update' ? file : id, one(parsed, 'data'), cwd)
    const given = one(parsed, 'title')?.trim()
    if (verb === 'new' && (!input.html || !given)) throw new Refusal('Use artifact new FILE.html --title TITLE')
    const title = given ? this.titled(given, previous ? previous.maker ?? previous.versions[0].chat : agent.chat) : undefined
    if (verb === 'check' && !input.html) throw new Refusal('Give an HTML file to check')
    if (previous && !input.html && !input.hasData && !title) throw new Refusal('Give new HTML, data or a title')
    const page = previous && this.page(previous.id)
    const result = input.html || input.hasData || verb === 'check' ? await this.check(input.html ?? page!.html, input.hasData ? input.data : page?.data, input.missing) : undefined
    if (verb === 'check') return this.report(agent, result!)
    const report = result ? await this.report(agent, result) : ''
    const thumbs = result?.shots ? { light: readFileSync(result.shots.light).toString('base64'), dark: readFileSync(result.shots.dark).toString('base64') } : undefined
    const current = this.source.agents.get(agent.chat)
    if (agent.pilot) this.source.pilots.policy.actor(agent.pilot.run, this.source.pilots.actor(agent))
    const terminal = current && this.source.agents.terminal(current)
    if (current?.grant !== agent.grant || current.launch !== agent.launch || terminal?.state !== 'live' || agent.pid && terminal.pid !== agent.pid || !this.source.mailbox.permits(agent.grant, { chat: agent.chat, session: agent.launch, machine: agent.machine }, 'artifact')) throw new Refusal('This artifact request belongs to a stopped, revoked or replaced session; nothing was published')
    let newId = randomBytes(4).toString('hex')
    while (this.source.store.get('artifact-id', newId) || this.source.store.get('core-artifact', newId)) newId = randomBytes(4).toString('hex')
    const artifact: Record = previous ?? { id: newId, title: title!, place: space?.id || agent.space, at: Date.now(), maker: agent.chat, versions: [] }
    if (title) artifact.title = title
    const old = artifact.versions.at(-1), n = (old?.n ?? 0) + 1
    const by = agent.role === 'task' ? `${this.source.tasks.forChat(agent.chat)?.id || agent.chat} agent` : (this.source.space(agent.space) ? coreSpaceName(this.source, this.source.space(agent.space)!) : 'Coordinator')
    const version: Version = { n, at: Date.now(), by, chat: agent.chat, note: one(parsed, 'note'), html: input.html ? n : old!.html, data: input.hasData ? n : old?.data, ...(!input.html ? { what: input.hasData ? 'data' as const : 'title' as const } : {}) }
    this.source.store.db.transaction(() => {
      this.source.store.set('artifact-id', artifact.id, artifact.id)
      if (input.html) { this.source.store.set('artifact-html', `${artifact.id}:${n}`, input.html); delete artifact.sent }
      if (input.hasData) this.source.store.set('artifact-data', `${artifact.id}:${n}`, input.data)
      artifact.versions.push(version); artifact.at = version.at; if (thumbs) {
        artifact.thumb = true
        this.source.store.set('artifact-thumb', `${artifact.id}:light`, thumbs.light); this.source.store.set('artifact-thumb', `${artifact.id}:dark`, thumbs.dark)
      }
      const removed = artifact.versions.splice(0, Math.max(0, artifact.versions.length - 20))
      const retainedHtml = new Set(artifact.versions.map(version => version.html)), retainedData = new Set(artifact.versions.map(version => version.data))
      for (const gone of removed) { if (!retainedHtml.has(gone.html)) this.source.store.delete('artifact-html', `${artifact.id}:${gone.html}`); if (gone.data && !retainedData.has(gone.data)) this.source.store.delete('artifact-data', `${artifact.id}:${gone.data}`) }
      this.source.store.set('core-artifact', artifact.id, artifact)
      this.source.store.set(`message:${agent.chat}`, `artifact-${artifact.id}-${n}`, { id: `artifact-${artifact.id}-${n}`, who: 'agent', artifact: { id: artifact.id, v: n }, at: version.at })
    })()
    this.source.emit('chat', agent.chat); this.source.emit('snapshot')
    return `${previous ? 'Updated' : 'Shown'}: artifact ${artifact.id} “${artifact.title}” v${n}. ${report}\nUpdate this same artifact rather than making another. Do not describe it in your reply; the human sees it.`
  }
  async act(action: Extract<Action, { type: 'artifact-send' | 'artifact-note' | 'artifact-say' | 'artifact-delete' }>) {
    const artifact = this.get(action.artifact)
    if (this.updating.has(artifact.id)) throw new Refusal('This artifact is being updated; try again after it finishes')
    if (artifact.place !== action.place) throw new Refusal('This artifact belongs to another space')
    if (action.type === 'artifact-delete') {
      for (const version of artifact.versions) { this.source.store.delete('artifact-html', `${artifact.id}:${version.html}`); if (version.data) this.source.store.delete('artifact-data', `${artifact.id}:${version.data}`) }
      this.source.store.delete('artifact-thumb', `${artifact.id}:light`); this.source.store.delete('artifact-thumb', `${artifact.id}:dark`)
      this.source.store.delete('core-artifact', artifact.id); this.source.emit('snapshot'); return { ok: true }
    }
    const version = this.version(artifact, action.v), chat = this.keeper(artifact)
    const text = action.type === 'artifact-note' ? action.note : action.text
    const tag = action.type === 'artifact-note' ? 'artifact-note' : action.type === 'artifact-say' ? 'artifact-comment' : 'artifact-sent'
    this.source.saveAndDeliver(chat, `artifact-action-${randomBytes(12).toString('hex')}`, chatTag(tag, { from: this.source.snapshot().user || 'You', artifact: artifact.id, version: version.n, title: artifact.title, target: action.type === 'artifact-note' ? action.target : undefined }, text), () => {
      if (action.type === 'artifact-send') { artifact.sent = { html: version.html, text }; this.source.store.set('core-artifact', artifact.id, artifact) }
    })
    this.source.emit('snapshot'); return { to: this.name(chat) }
  }
}

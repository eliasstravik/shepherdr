import { createHash, randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { closeSync, constants, fstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import type { Action, Message, Reaction } from '../../shared/types.ts'
import { agentLines, excerpt, findQuoted, line, parseReply, parseUserLine, userLines } from '../common/chatlines.ts'
import type { CoreSource } from './source.ts'

interface Upload { id: string; chat: string; path: string; name: string; copies?: Record<string, string>; paths?: string[] }

/** The same chat-line language as 2.0, projected from native logs, never terminal text. */
export function chatMessages(raw: Message[]): Message[] {
  const out: Message[] = []
  const react = (message: Message | undefined, emoji: string, by: 'me' | 'them', on: boolean) => {
    if (!message) return
    const old = message.reactions?.find(item => item.emoji === emoji)
    const other = old?.by === 'both' || old?.by === (by === 'me' ? 'them' : 'me')
    const next: Reaction | undefined = on ? { emoji, by: other ? 'both' : by } : other ? { emoji, by: by === 'me' ? 'them' : 'me' } : undefined
    message.reactions = [...(message.reactions ?? []).filter(item => item.emoji !== emoji), ...(next ? [next] : [])]
  }
  for (const original of raw) {
    const message = { ...original, reactions: original.reactions?.map(item => ({ ...item })) }
    if (!message.text) { out.push(message); continue }
    if (message.who === 'agent') {
      const parsed = agentLines(message.text)
      for (const reaction of parsed.reactions) react(findQuoted(out, reaction.to, reaction.path), reaction.emoji, 'them', true)
      if (!parsed.text) continue
      message.text = parsed.text
      if (parsed.reply) { const target = findQuoted(out, parsed.reply.to, parsed.reply.path); message.reply = { text: excerpt(target?.text || target?.file?.name || parsed.reply.to), ...(target ? { id: target.id } : {}) } }
      out.push(message); continue
    }
    const reply = parseReply(message.text)
    if (reply) {
      const version = reply.to.match(/ · v(\d+)$/)?.[1]
      const target = reply.artifact ? out.findLast(item => item.artifact?.id === reply.artifact && (!version || item.artifact?.v === Number(version))) : findQuoted(out, reply.to)
      message.reply = { text: reply.to, ...(reply.artifact ? { artifact: true } : {}), ...(target ? { id: target.id } : {}) }
    }
    const files: { name: string; path: string }[] = [], words: string[] = []
    for (const text of reply ? [...userLines(reply.text), ...reply.rest] : userLines(message.text)) {
      const parsed = parseUserLine(text)
      if (parsed?.kind === 'attach') files.push({ name: parsed.name, path: parsed.path })
      else if (parsed?.kind === 'react' || parsed?.kind === 'unreact') {
        const target = parsed.artifact ? out.findLast(item => item.artifact?.id === parsed.artifact!.id && item.artifact.v === parsed.artifact!.v) : findQuoted(out, parsed.to, parsed.path)
        react(target, parsed.emoji, 'me', parsed.kind === 'react')
      } else words.push(text)
    }
    const text = words.join('\n').trim()
    if (text) out.push({ ...message, text })
    files.forEach((file, index) => out.push({ ...message, text: undefined, id: text || index ? `${message.id}:file:${index}` : message.id, file, reply: !text && !index ? message.reply : undefined }))
  }
  return out
}

/** Files are uploaded to the app, then copied only to their chat's owning machine through core. */
export class CoreChat {
  constructor(private source: CoreSource, private installation: string) {}
  private records() { return this.source.store.all<Upload>('upload') }
  async upload(chat: string, name: string, bytes: Uint8Array) {
    if (!this.source.chat(chat)) throw new Error('No such chat')
    if (bytes.length > 32 * 1024 * 1024) throw new Error('Attachment is too large')
    const clean = basename(name).replace(/[\r\n\x00-\x1f]/g, '').replace(/"/g, '”').slice(0, 180) || 'attachment'
    const directory = join(this.source.config.home, 'uploads'); mkdirSync(directory, { recursive: true, mode: 0o700 })
    const id = randomUUID(), path = join(directory, id + '-' + clean)
    writeFileSync(path, bytes, { mode: 0o600, flag: 'wx' })
    this.source.store.set('upload', id, { id, chat, path, name: clean } satisfies Upload)
    return path
  }
  uploadName(chat: string, path: string) { return this.records().find(item => item.chat === chat && item.path === path)?.name }
  async attachment(chat: string, path: string) {
    const record = this.records().find(item => item.chat === chat && (item.path === path || [...Object.values(item.copies ?? {}), ...(item.paths ?? [])].includes(path)))
    return record ? new Blob([this.read(record)], { type: Bun.file(record.path).type }) : null
  }
  private read(record: Upload) {
    const fd = openSync(record.path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try { const stat = fstatSync(fd); if (!stat.isFile() || stat.nlink !== 1 || stat.size > 32 * 1024 * 1024) throw new Error('Attachment is no longer a regular uploaded file'); return readFileSync(fd) }
    finally { closeSync(fd) }
  }
  private async copy(record: Upload, machine: string) {
    if (machine === this.source.localMachineId()) return record.path
    const bytes = this.read(record), bun = await this.source.agents.bun(machine)
    const script = `const f=require('node:fs'),p=require('node:path'),o=require('node:os'),c=require('node:crypto'),x=JSON.parse(await Bun.stdin.text());const dir=p.join(o.homedir(),'.cache/shepherdr-inbox',x.installation);f.mkdirSync(dir,{recursive:true,mode:0o700});const d=f.lstatSync(dir);if(!d.isDirectory()||d.isSymbolicLink()||(d.mode&0o077)||d.uid!==process.getuid()||f.realpathSync(dir)!==dir)throw Error('Uploads need a private real directory');const path=p.join(dir,x.name);if(x.first)f.writeFileSync(path,Buffer.alloc(0),{flag:'wx',mode:0o600});const fd=f.openSync(path,f.constants.O_RDWR|f.constants.O_NOFOLLOW);try{const s=f.fstatSync(fd);if(!s.isFile()||s.nlink!==1||s.size!==x.offset||s.uid!==process.getuid()||(s.mode&0o077))throw Error('Upload changed during transfer');const b=Buffer.from(x.data,'base64');let n=0;while(n<b.length)n+=f.writeSync(fd,b,n,b.length-n,x.offset+n);if(x.hash&&c.createHash('sha256').update(f.readFileSync(fd)).digest('hex')!==x.hash)throw Error('Upload checksum mismatch');process.stdout.write(path)}finally{f.closeSync(fd)}`
    let path = ''
    const chunk = 2 * 1024 * 1024, name = `${randomUUID()}-${record.name}`
    for (let offset = 0; offset < bytes.length || offset === 0; offset += chunk) {
      const last = offset + chunk >= bytes.length
      path = (await this.source.files.exec(machine, [bun, '-e', script], undefined, Buffer.from(JSON.stringify({ installation: this.installation, name, first: offset === 0, offset, data: bytes.subarray(offset, offset + chunk).toString('base64'), hash: last ? createHash('sha256').update(bytes).digest('hex') : undefined })))).toString('utf8')
    }
    // Each deliberate send gets a fresh copy. Keep earlier attachment URLs working.
    const latest = this.source.store.get<Upload>('upload', record.id)
    if (!latest || latest.chat !== record.chat) throw new Error('This upload was removed during transfer')
    latest.paths = [...new Set([...(latest.paths ?? []), path])]; this.source.store.set('upload', latest.id, latest)
    return path
  }
  async text(action: Extract<Action, { type: 'send' }>, machine: string) {
    let text = action.text
    if (action.reply) {
      const message = this.source.chat(action.chat)?.messages.find(item => item.id === action.reply)
      const artifact = message?.artifact && this.source.artifacts.list().find(item => item.id === message.artifact!.id)
      if (artifact) text = line.replyArtifact(this.source.snapshot().user || 'You', line.artifact(artifact.title, artifact.id, message!.artifact!.v), text)
      else if (message?.text || message?.file) text = line.reply(this.source.snapshot().user || 'You', message.text || message.file!.name, text)
    }
    const paths = action.attachments ?? []
    if (paths.length > 20 || new Set(paths).size !== paths.length) throw new Error('Send at most 20 different attachments at once')
    const records = paths.map(path => { const record = this.records().find(item => item.chat === action.chat && item.path === path); if (!record) throw new Error('That file was not uploaded to this chat'); return record })
    const files: string[] = []
    for (const record of records) files.push(line.attach(this.source.snapshot().user || 'You', record.name, await this.copy(record, machine)))
    return [text, ...files].filter(Boolean).join('\n')
  }
  reaction(chat: string, id: string, emoji: string) {
    if (!emoji || emoji.length > 32) throw new Error('Choose a reaction')
    const message = this.source.chat(chat)?.messages.find(item => item.id === id)
    if (!message) throw new Error('No such message')
    const mine = message.reactions?.some(item => item.emoji === emoji && item.by !== 'them')
    const artifact = message.artifact && this.source.artifacts.list().find(item => item.id === message.artifact!.id)
    if (artifact) return (mine ? line.unreactArtifact : line.reactArtifact)(this.source.snapshot().user || 'You', emoji, line.artifact(artifact.title, artifact.id, message.artifact!.v))
    if (message.file) return (mine ? line.unreactFile : line.reactFile)(this.source.snapshot().user || 'You', emoji, message.file.name, message.file.path)
    if (message.text) return (mine ? line.unreact : line.react)(this.source.snapshot().user || 'You', emoji, message.text)
    throw new Error('This message cannot take reactions')
  }
}

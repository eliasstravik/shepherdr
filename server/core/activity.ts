import { activityOf, cutOutput, lineOf, outputFromLine, shown, stepsNow, type JobRec, type StepRec } from '../activity.ts'
import type { ActivityAnswer, ActivityAsk, Message } from '../../shared/types.ts'
import { CoreNativeFile } from './native-file.ts'
import { CoreChildSteps } from './child-steps.ts'
import { ClaudeReader } from '../common/readers/claude.ts'
import { CodexReader } from '../common/readers/codex.ts'
import type { LogEvent, Reader } from '../common/readers/types.ts'
import type { CoreSource } from './source.ts'
import type { AgentKind } from './model.ts'

/** Native tool events are the only source of activity. No terminal output is parsed. */
export class CoreActivity {
  private resolved = new Map<string, string>()
  private jobSteps = new Map<string, { chat: string; steps: StepRec[] }>()
  private children = new Map<string, { file: CoreNativeFile; reader: Reader; projection: CoreChildSteps; warning?: string; running?: Promise<ActivityAnswer> }>()
  constructor(private source: CoreSource) {}
  private events(chat: string) { return this.source.store.all<LogEvent>(`event:${chat}`) }
  private state(chat: string) { return activityOf(this.events(chat)) }
  private held(chat: string) { const agent = this.source.agents.get(chat); return !!agent && this.source.openPermissions(agent).length > 0 }
  chat(chat: string, messages: Message[], live: boolean) {
    const state = this.state(chat), output = [...messages], held = this.held(chat)
    const recorded = this.source.store.all<Message & { source?: string }>(`message:${chat}`)
    const visible = (id?: string) => id ? output.find(message => message.id === id || recorded.some(record => record.id === message.id && record.source === id)) : undefined
    const ended = [...state.turns, ...(!live && !held && state.open ? [{ ...state.open, end: Math.max(state.open.at, ...state.open.steps.map(step => step.end ?? step.at)) }] : [])]
    // At a permission card its turn is still open: what it is held on has not happened.
    for (const turn of held && state.open ? [...ended, state.open] : ended) {
      if (!turn.steps.length) continue
      const reply = visible(turn.reply)
      if (!reply && !visible(turn.asked)) continue // Hidden news remains quiet, as in 2.0.
      output.push({ id: `activity-${turn.id}`, who: 'agent', at: reply ? (reply.at ?? turn.at) - 0.5 : turn.end ?? Math.max(turn.at, ...turn.steps.map(step => step.end ?? step.at)), activity: lineOf(turn, false, turn === state.open) })
    }
    output.sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
    return { messages: output, live: live && state.open ? lineOf(state.open, true) : undefined,
      jobs: state.jobs.map(({ log, output, ...job }) => {
        const last = this.jobSteps.get(`${chat}:${job.id}`)?.steps.at(-1)
        return { ...job, now: last ? last.end ? last.title : last.doing : undefined, more: job.more || (job.kind === 'agent' && this.source.agents.get(chat)?.kind === 'codex' ? 'steps' as const : undefined) }
      }) }
  }
  async ask(ask: ActivityAsk): Promise<ActivityAnswer> {
    const agent = this.source.agents.get(ask.chat)
    if (!agent) return { error: 'No such chat' }
    const state = this.state(ask.chat), turns = [...state.turns, ...(state.open ? [state.open] : [])]
    if (ask.what === 'turn') {
      const turn = turns.find(turn => turn.id === ask.id)
      return turn ? { steps: stepsNow(turn, turn === state.open && this.held(ask.chat)).map(shown) } : { error: 'This turn is no longer available' }
    }
    if (ask.what === 'output') {
      const step = [...turns.flatMap(turn => turn.steps), ...[...this.jobSteps.values()].filter(job => job.chat === ask.chat).flatMap(job => job.steps)].find(step => step.id === ask.id)
      if (!step?.where) return { error: 'This step has no recorded output' }
      const line = await this.read(agent.machine, step.where.file, step.where.offset)
      const output = line.text && outputFromLine(line.text, step.id)
      return output === undefined ? { error: 'This output is no longer available' } : cutOutput(output)
    }
    const job = state.jobs.find(job => job.id === ask.id)
    if (!job) return { error: 'This background job is no longer running' }
    if (job.output) {
      const read = await this.read(agent.machine, job.output, undefined), result = cutOutput(read.text)
      return { ...result, cut: result.cut || read.cut || undefined }
    }
    if (job.log) return this.job(ask.chat, agent.machine, job, agent.kind)
    if (agent.kind === 'codex' && job.kind === 'agent') {
      const log = await this.codexLog(agent.machine, agent.transcript, job.id)
      if (log) return this.job(ask.chat, agent.machine, { ...job, log }, agent.kind)
    }
    return { error: 'This job has no native output location' }
  }
  private async codexLog(machine: string, transcript: string | undefined, id: string) {
    if (!transcript || !/^[a-zA-Z0-9-]{16,128}$/.test(id)) return undefined
    const at = transcript.lastIndexOf('/sessions/')
    if (at < 0) return undefined
    const key = `${machine}:${id}`, known = this.resolved.get(key)
    if (known) return known
    const root = transcript.slice(0, at + '/sessions'.length), bun = await this.source.agents.bun(machine)
    const script = `const f=require('node:fs'),p=require('node:path'),x=JSON.parse(await Bun.stdin.text());let seen=0;function walk(dir,depth){if(depth>3||seen>=20000)return;let names;try{names=f.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>b.name.localeCompare(a.name))}catch{return}for(const name of names){if(++seen>20000)return;const file=p.join(dir,name.name);if(name.isDirectory()){const found=walk(file,depth+1);if(found)return found}else if(name.isFile()&&name.name.endsWith('-'+x.id+'.jsonl'))return file}}process.stdout.write(walk(x.root,0)||'')`
    const path = (await this.source.files.exec(machine, [bun, '-e', script], undefined, Buffer.from(JSON.stringify({ root, id })))).toString('utf8')
    if (path) { this.resolved.set(key, path); while (this.resolved.size > 40) this.resolved.delete(this.resolved.keys().next().value!) }
    return path || undefined
  }
  private async job(chat: string, machine: string, job: JobRec, kind: AgentKind): Promise<ActivityAnswer> {
    const key = `${chat}:${job.id}`
    let child = this.children.get(key)
    if (!child || child.file.path !== job.log || child.reader.cli !== kind) {
      child = { file: new CoreNativeFile(job.log!), reader: kind === 'codex' ? new CodexReader() : new ClaudeReader(true), projection: new CoreChildSteps() }
      this.children.set(key, child)
    }
    if (child.running) return child.running
    const current = child
    current.running = (async () => {
      const bun = await this.source.agents.bun(machine)
      let more = false
      for (let count = 0; count < 4; count++) {
        const batch = await current.file.read(this.source.files, machine, bun, () => {
          current.reader.reset?.(job.log!); current.projection.reset(); current.warning = undefined
        })
        if (batch.oversized) current.warning = 'A native log record exceeds the 64 MiB display limit and was skipped.'
        for (const event of current.reader.parse(batch.lines, job.log!)) current.projection.apply(event)
        more = batch.more
        if (!more) break
      }
      const steps = [...current.projection.steps.values()]
      this.jobSteps.set(key, { chat, steps })
      while (this.jobSteps.size > 40) this.jobSteps.delete(this.jobSteps.keys().next().value!)
      // Keep the cursor with its output links. A later opening resumes at EOF.
      while (this.children.size > 40) {
        const old = [...this.children].find(([id, value]) => id !== key && !value.running)
        if (!old) break
        this.children.delete(old[0])
      }
      return { steps: steps.slice(-200).map(shown), more: current.projection.omitted || undefined,
        catchingUp: more || undefined, warning: current.warning }
    })()
    try { return await current.running } finally { current.running = undefined }
  }

  private async read(machine: string, path: string, offset?: number) {
    const bun = await this.source.agents.bun(machine)
    const script = `const f=require('node:fs'),x=JSON.parse(await Bun.stdin.text());const fd=f.openSync(x.path,'r');try{const s=f.fstatSync(fd);if(!s.isFile())throw Error('No such native output');const from=x.offset===undefined?Math.max(0,s.size-262144):x.offset;if(!Number.isSafeInteger(from)||from<0)throw Error('Invalid native output offset');const b=Buffer.alloc(Math.min(x.offset===undefined?262144:4194304,Math.max(0,s.size-from)));let n=0;while(n<b.length){const got=f.readSync(fd,b,n,b.length-n,from+n);if(!got)break;n+=got}let text=b.subarray(0,n).toString('utf8');if(x.offset!==undefined){const end=text.indexOf('\\n');if(end<0&&from+n<s.size)throw Error('Native output line exceeds the display limit');if(end>=0)text=text.slice(0,end)}else if(from){const end=text.indexOf('\\n');text=end<0?'':text.slice(end+1)}process.stdout.write(JSON.stringify({data:Buffer.from(text).toString('base64'),cut:x.offset===undefined&&from>0}))}finally{f.closeSync(fd)}`
    const result = JSON.parse((await this.source.files.exec(machine, [bun, '-e', script], undefined, Buffer.from(JSON.stringify({ path, offset })))).toString('utf8')) as { data: string; cut: boolean }
    return { text: Buffer.from(result.data, 'base64').toString('utf8'), cut: result.cut }
  }
}

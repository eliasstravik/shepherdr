import type { LogEvent } from '../common/readers/types.ts'
import type { StepRec } from '../activity.ts'

/** Only the displayed tail is cached. Native text/output stays in its source file. */
export class CoreChildSteps {
  readonly steps = new Map<string, StepRec>()
  omitted = 0
  reset() { this.steps.clear(); this.omitted = 0 }
  apply(event: LogEvent) {
    if (event.kind === 'step') {
      if (this.steps.has(event.id)) return
      const { kind: _kind, step, out, ...words } = event
      const short = (text: string | undefined, max: number) => text && text.length > max ? text.slice(0, max) + '… (shortened)' : text
      this.steps.set(event.id, { ...words, kind: step, where: out,
        title: short(event.title, 512)!, doing: short(event.doing, 512)!, target: short(event.target, 4096)!, detail: short(event.detail, 65536), result: short(event.result, 4096) })
      if (this.steps.size > 200) { this.steps.delete(this.steps.keys().next().value!); this.omitted++ }
    } else if (event.kind === 'step-end') {
      const current = this.steps.get(event.id)
      if (event.drop) {
        if (!this.steps.delete(event.id)) this.omitted = Math.max(0, this.omitted - 1)
      } else if (current) {
        Object.assign(current, { end: event.at, failed: event.failed, where: event.out ?? current.where }, event.result ? { result: event.result.slice(0, 4096) + (event.result.length > 4096 ? '… (shortened)' : '') } : {})
      }
    }
  }
}

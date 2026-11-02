import type { LogEvent, Reader } from '../common/readers/types.ts'

/** Documented codex exec --json events, with private capture timestamps. No terminal parsing. */
export class CoreReviewReader implements Reader {
  cli = 'codex'
  parse(lines: { text: string; offset: number }[], file: string): LogEvent[] {
    const events: LogEvent[] = []
    for (const line of lines) {
      let envelope
      try { envelope = JSON.parse(line.text) } catch { continue }
      const event = envelope.event, at = envelope.at, id = `${file}:${line.offset}`
      if (!event || !Number.isFinite(at)) continue
      if (event.type === 'thread.started' && typeof event.thread_id === 'string') events.push({ kind: 'session', id, at, sessionId: event.thread_id, file })
      if (event.type === 'turn.started') events.push({ kind: 'turn-start', id, at })
      if (event.type === 'turn.completed') {
        events.push({ kind: 'turn-end', id, at })
        const tokens = Number(event.usage?.input_tokens || 0) + Number(event.usage?.output_tokens || 0)
        if (Number.isFinite(tokens)) events.push({ kind: 'usage', id: id + ':usage', at, tokens })
      }
      if (event.type === 'turn.failed') events.push({ kind: 'turn-end', id, at, aborted: true })
      if ((event.type === 'error' || event.type === 'turn.failed') && typeof (event.message ?? event.error?.message) === 'string') events.push({ kind: 'error', id, at, text: event.message ?? event.error.message })
      if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') events.push({ kind: 'agent', id, at, text: event.item.text })
      if (event.type === 'item.completed' && event.item?.type === 'command_execution') events.push({ kind: 'step', id, at, step: 'run', tool: 'command_execution', out: { file, offset: line.offset }, title: String(event.item.command || 'Command'), doing: 'Ran', target: String(event.item.command || 'Command'), end: at, failed: event.item.status === 'failed' || event.item.exit_code != null && event.item.exit_code !== 0 })
    }
    return events
  }
}

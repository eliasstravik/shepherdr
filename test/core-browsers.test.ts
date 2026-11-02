import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreSource } from '../server/core/source.ts'
import { prepareHome } from '../server/core/home.ts'
import { browserNamespace, browserSession } from '../server/core/browser-id.ts'
import { browserOpen, browserPacket, BROWSER_OSC } from '../server/core/browser-protocol.ts'
import type { CoreTerminal } from '../server/core/protocol.ts'
import type { CoreClient } from '../server/core/client.ts'

test('browser controls use only the owning core child, await cleanup and never replay input after disconnection', async () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-browser-')), source = new CoreSource({ home, port: 17887, socket: '/unused', session: 'test', binary: 'hc' })
  const installation = prepareHome(home).id, machine = source.localMachineId(), space = `p:${machine}:demo`, chat = 'DEMO-1/Agent', session = browserSession(chat)
  source.store.set('space', space, { id: space, name: 'demo', machine, folder: '/repo', base: 'main', prefix: 'DEMO', mode: 'regular', added: 1 })
  source.store.set('task', 'DEMO-1', { id: 'DEMO-1', chat, name: 'Example', desc: 'Example', place: space, machine, folder: '/worktree', repo: '/repo', branch: 'work/1-example', base: 'main', kind: 'claude', workflow: 'working', status: 'work', state: 'Working', review: { on: false }, mergePolicy: 'ask', age: 'now', created: new Date().toISOString(), on: 'test' })
  source.store.set('agent', chat, { chat, space, machine, role: 'task', kind: 'claude', launch: 'launch', grant: 'grant', hook: '/unused', state: 'idle', started: 1,
    browser: { namespace: browserNamespace(installation), session, profile: join(home, 'browser', session) } })
  source.core.current.connected = true
  source.agents.terminal = (() => ({ address: 't1', pid: 11, state: 'live' })) as unknown as typeof source.agents.terminal
  source.agents.browserRuntime = async () => ({ root: '/app', bun: process.execPath, bin: '/app/bin/agent-browser', sessions: join(home, 'sessions') })
  source.files.exec = async (_machine, argv) => Buffer.from(argv[2]?.includes('x.filter(t=>') ? JSON.stringify(['DEMO-1']) : '')
  let runs = 0, receive: Parameters<CoreClient['attach']>[1] | undefined, finishClose: (() => void) | undefined
  const inputs: { type: string; message?: { type: string } }[] = [], shown: string[] = []
  const key = () => source.store.get<{ key: string }>('browser-relay', 'DEMO-1')!.key
  const emit = (value: unknown) => receive!.data(Buffer.concat([BROWSER_OSC, Buffer.from(browserPacket(key(), 'down', value)), Buffer.from([7])]))
  source.core.call = async <T>(method: string, args: Record<string, unknown>) => {
    expect(method).toBe('terminal.run'); runs++
    expect(args.argv).toEqual(['sh', '-c', expect.stringContaining('stty raw -echo && exec')])
    expect(args.outlive_parent).toBe(true)
    const terminal = { address: 't2', pid: 22, state: 'live', labels: args.labels }
    ;(source.core.current.terminals as Map<string, CoreTerminal>).set('t2', terminal as CoreTerminal)
    return terminal as T
  }
  source.core.attach = async (_terminal, stream) => {
    expect(_terminal).toBe('t2') // A copied browser label on another address is never its private binding.
    receive = stream
    return { input(bytes: Uint8Array) {
      const command = browserOpen(key(), 'up', Buffer.from(bytes).toString().trim()) as { id: string; input: typeof inputs[number] }
      inputs.push(command.input)
      const ack = () => emit({ type: 'ack', id: command.id, ok: true })
      if (command.input.type === 'close') finishClose = () => { ack(); stream.close({ reason: 'exited' }) }
      else ack()
      if (command.input.type === 'watch') emit({ type: 'down', message: { type: 'state', driver: 'agent', url: 'about:blank', title: '', connected: true, viewport: { w: 1280, h: 720 } } })
    }, resize() {}, close() { stream.close({ reason: 'disconnected' }) } }
  }
  await source.browsers.detectAgentBrowsers()
  expect(runs).toBe(1)
  expect(inputs[0]?.type).toBe('configure')
  expect(inputs.some(input => input.type === 'watch')).toBe(false)
  const viewer = source.browser('DEMO-1', { send: text => shown.push(text), close() {}, buffered: () => 0 })
  try {
    await Bun.sleep(0)
    expect(runs).toBe(1)
    expect(shown.some(raw => JSON.parse(raw).type === 'state')).toBe(true)
    const delivered: string[] = []
    source.agents.send = async (_chat, text) => {
      delivered.push(text)
      for (const item of source.store.all<{ id: string; text: string }>('pending-send')) if (item.text === text) source.store.delete('pending-send', item.id)
    }
    const news = { type: 'tell', id: 'abcdabcd-abcd-abcd-abcd-abcdabcdabcd', text: 'The browser was handed back.' }
    emit(news); await Bun.sleep(0); emit(news); await Bun.sleep(0)
    expect(delivered.filter(text => text.includes('<browser>'))).toHaveLength(1)
    expect(source.chat(chat)!.messages.some(message => message.text?.includes('saved your answer'))).toBe(false)
    const shot = await source.upload(chat, 'note-1-button.png', Buffer.from('own screenshot'))
    const otherShot = await source.upload(space, 'other.png', Buffer.from('another chat'))
    const notes = { type: 'browser-notes' as const, cid: 'browser-note-retry-1', chat, url: 'http://example.test', notes: [
      { comment: 'BROWSER_NOTE_TEST', pick: { element: 'button', selector: '#save', box: { x: 1, y: 2, w: 20, h: 20 }, at: { x: 1, y: 2 }, url: 'http://example.test', shot } },
      { comment: 'No other chat screenshot', pick: { element: 'button', selector: '#other', box: { x: 3, y: 4, w: 20, h: 20 }, at: { x: 3, y: 4 }, url: 'http://example.test', shot: otherShot } },
    ] }
    await source.act(notes); await Bun.sleep(0); await source.act(notes); await Bun.sleep(0)
    const sentNotes = delivered.filter(text => text.includes('BROWSER_NOTE_TEST'))
    expect(sentNotes).toHaveLength(1)
    expect(sentNotes[0]).toContain('Shot: note-1-button.png')
    expect(sentNotes[0]).toContain('name="note-1-button.png"')
    expect(sentNotes[0]).not.toContain(otherShot)
    viewer.message(JSON.stringify({ type: 'take' })); await Bun.sleep(0)
    expect(inputs.filter(input => input.message?.type === 'take')).toHaveLength(1)
    const actual = source.core.current.terminals.get('t2')!
    ;(source.core.current.terminals as Map<string, CoreTerminal>).delete('t2')
    ;(source.core.current.terminals as Map<string, CoreTerminal>).set('forged', { ...actual, address: 'forged' })
    ;(source.core.current.terminals as Map<string, CoreTerminal>).set('t2', actual)
    receive!.close({ reason: 'disconnected' })
    viewer.message(JSON.stringify({ type: 'input_keyboard', eventType: 'keyDown', key: 'Enter' }))
    await Bun.sleep(0)
    expect(inputs.some(input => input.message?.type === 'input_keyboard')).toBe(false)
    const other = source.browser('DEMO-1', { send() {}, close() {} })
    await Bun.sleep(0)
    expect(runs).toBe(1) // Adopt the same authenticated core child after reconnect.
    expect(inputs.filter(input => input.message?.type === 'take')).toHaveLength(1)
    receive!.close({ reason: 'disconnected' }) // Cleanup must reattach even with no live stream.
    let closed = false
    const closing = source.browsers.close('DEMO-1', true).then(() => { closed = true })
    await Bun.sleep(0)
    expect(closed).toBe(false)
    finishClose!(); await closing
    expect(closed).toBe(true)
    expect(source.store.get('browser-relay', 'DEMO-1')).toBeUndefined()
    other.end()
  } finally { viewer.end(); source.stop(); await Bun.sleep(0); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) }
})

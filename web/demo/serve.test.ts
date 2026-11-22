import { expect, test } from 'bun:test'
import { createServer } from 'node:net'

test('demo chat adds a task and a reminder to the expected places', async () => {
  const listener = createServer()
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve))
  const port = (listener.address() as { port: number }).port
  await new Promise<void>((resolve) => listener.close(() => resolve()))
  const child = Bun.spawn(['bun', 'web/demo/serve.ts', String(port)], { stdout: 'ignore', stderr: 'ignore' })
  const url = `http://127.0.0.1:${port}`
  try {
    let ws: WebSocket | undefined
    for (let i = 0; i < 30; i++) {
      try { if ((await fetch(`${url}/api/me`)).ok) break } catch {}
      await Bun.sleep(50)
    }
    const snapshots: any[] = [], chats: any[] = []
    ws = new WebSocket(`${url.replace('http:', 'ws:')}/api/ws`)
    ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (m.type === 'snapshot') snapshots.push(m.snapshot); if (m.type === 'chat') chats.push(m.chat) }
    await new Promise<void>((resolve, reject) => { ws!.onopen = () => resolve(); ws!.onerror = () => reject(new Error('demo socket failed')) })
    ws.send(JSON.stringify({ type: 'watch', chats: ['p:mac-mini:~'] }))
    const send = (text: string) => fetch(`${url}/api/action`, { method: 'POST', body: JSON.stringify({ type: 'send', chat: 'p:mac-mini:~', text }) })
    await send('Add a task to check labels, don\'t start it yet')
    await send('Remind me to pay the VAT on Friday')
    await send('Add a task to clean the menu')
    for (let i = 0; i < 30 && !Object.values(snapshots.at(-1)?.automations ?? {}).flat().some((a: any) => a.name === 'Pay the VAT'); i++) await Bun.sleep(20)
    for (let i = 0; i < 30 && !snapshots.at(-1)?.tasks.some((t: any) => t.name === 'Clean the menu'); i++) await Bun.sleep(20)
    const snap = snapshots.at(-1)
    expect(snap.tasks.find((t: any) => t.name === 'Check labels')).toMatchObject({ place: 'p:mac-mini:shop', status: 'todo' })
    expect(snap.tasks.find((t: any) => t.name === 'Clean the menu')).toMatchObject({ place: 'p:mac-mini:shop', status: 'work', report: { progress: 50 } })
    expect(Object.values(snap.automations).flat().find((a: any) => a.name === 'Pay the VAT')).toMatchObject({ when: 'Once · Friday 9:00', once: true })
    await send('File this feedback as an issue on the Shepherdr GitHub repository: “Make it clearer”')
    for (let i = 0; i < 50 && !chats.at(-1)?.messages.some((m: any) => m.text?.startsWith('Filed as issue')); i++) await Bun.sleep(20)
    expect(chats.at(-1).messages.some((m: any) => m.text?.startsWith('Filed as issue'))).toBe(true)
    await fetch(`${url}/`, { headers: { accept: 'text/html' } })
    for (let i = 0; i < 30 && snapshots.at(-1)?.tasks.some((t: any) => t.name === 'Check labels'); i++) await Bun.sleep(20)
    expect(snapshots.at(-1).tasks.some((t: any) => t.name === 'Check labels')).toBe(false)
    expect(Object.values(snapshots.at(-1).automations).flat().some((a: any) => a.name === 'Pay the VAT')).toBe(false)
    ws.close()
  } finally { child.kill(); await child.exited }
})

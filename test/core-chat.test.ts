import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, linkSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chatMessages } from '../server/core/chat.ts'
import { CoreSource } from '../server/core/source.ts'
import type { CoreSpace } from '../server/core/model.ts'
import { runChild } from './child.ts'

test('native attachment/reply lines and both reaction sides retain the original message identity', () => {
  const messages = chatMessages([
    { id: 'a', who: 'agent', text: 'The example is ready', at: 1 },
    { id: 'r', who: 'you', text: '<reaction from="You" emoji="👍" to="The example"/>', at: 2 },
    { id: 'b', who: 'you', text: '<reply from="You" to="The example is ready">Check this</reply>\n<attachment from="You" name="proof.txt" path="/remote/inbox/proof.txt"/>', at: 3 },
    { id: 'c', who: 'agent', text: '<react emoji="👍" to="The example"/>\n<reply to="Check this"/>\nChecked it', at: 4 },
    { id: 'remove', who: 'you', text: '<reaction-removed from="You" emoji="👍" to="The example"/>', at: 5 },
  ])
  expect(messages.map(message => message.id)).toEqual(['a', 'b', 'b:file:0', 'c'])
  expect(messages[0].reactions).toEqual([{ emoji: '👍', by: 'them' }])
  expect(messages[1].reply).toMatchObject({ id: 'a' })
  expect(messages[2].file).toEqual({ name: 'proof.txt', path: '/remote/inbox/proof.txt' })
  expect(messages[3]).toMatchObject({ text: 'Checked it', reply: { id: 'b' } })
})

test('empty replies stay hidden and a file-only message keeps its client receipt', () => {
  expect(chatMessages([{ id: 'none', who: 'agent', text: '<no-reply>nothing needed</no-reply>' }])).toEqual([])
  expect(chatMessages([{ id: 'file', cid: 'client', who: 'you', text: '<attachment from="You" name="proof.txt" path="/file"/>' }])).toEqual([
    expect.objectContaining({ id: 'file', cid: 'client', file: { name: 'proof.txt', path: '/file' }, text: undefined }),
  ])
})

test('remote uploads cross core in bounded chunks, retain bytes and cannot borrow another chat file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shep-chat-')), source = new CoreSource({ home: join(root, 'app'), port: 17887, session: 'test', socket: '/unused', binary: 'hc' })
  const space: CoreSpace = { id: 'p:remote:~', machine: 'remote', name: '~', home: true, folder: root, base: 'main', prefix: 'TASK', mode: 'regular', added: 1 }
  source.store.set('space', space.id, space)
  source.store.set('setting', 'user', 'Avery Lee')
  source.agents.bun = async () => process.execPath
  const sizes: number[] = []
  source.files.exec = async (_machine, argv, cwd, input) => {
    sizes.push(input?.length ?? 0)
    return runChild(argv, { cwd, input, env: { ...process.env, HOME: root, USERPROFILE: root } })
  }
  try {
    const bytes = Buffer.alloc(3 * 1024 * 1024, 17), path = await source.upload(space.id, 'proof"1.bin', bytes)
    const text = await source.chats.text({ type: 'send', chat: space.id, text: '', attachments: [path] }, space.machine)
    expect(text).toContain('from="Avery Lee"')
    const file = chatMessages([{ id: 'file', who: 'you', text }])[0].file!
    expect(file.path).not.toBe(path)
    expect(file.path).not.toContain('"')
    expect(sizes).toHaveLength(2)
    expect(Math.max(...sizes)).toBeLessThan(4 * 1024 * 1024)
    expect(Buffer.from(await (await source.attachment(space.id, file.path))!.arrayBuffer())).toEqual(bytes)
    expect(await source.attachment('another-chat', file.path)).toBeNull()
    await expect(source.chats.text({ type: 'send', chat: 'another-chat', text: '', attachments: [path] }, space.machine)).rejects.toThrow('not uploaded')
    await expect(source.chats.text({ type: 'send', chat: space.id, text: '', attachments: ['/etc/passwd'] }, space.machine)).rejects.toThrow('not uploaded')
    unlinkSync(file.path)
    const again = await source.chats.text({ type: 'send', chat: space.id, text: '', attachments: [path] }, space.machine)
    const next = chatMessages([{ id: 'again', who: 'you', text: again }])[0].file!
    expect(next.path).not.toBe(file.path)
    expect(Buffer.from(await Bun.file(next.path).arrayBuffer())).toEqual(bytes)
    expect(await source.attachment(space.id, file.path)).not.toBeNull() // Earlier URLs still download the original.
    const simultaneous = await Promise.all([1, 2].map(() => source.chats.text({ type: 'send', chat: space.id, text: '', attachments: [path] }, space.machine)))
    for (const text of simultaneous) {
      const copied = chatMessages([{ id: 'parallel', who: 'you', text }])[0].file!
      expect(await source.attachment(space.id, copied.path)).not.toBeNull()
    }
    const uploads = source.store.all<{ path: string }>('upload')
    linkSync(uploads[0].path, join(root, 'hardlink'))
    await expect(source.attachment(space.id, path)).rejects.toThrow('regular uploaded file')
    unlinkSync(join(root, 'hardlink'))
    // The returned remote attachment is the complete binary, not a truncated core frame.
    expect(Bun.file(next.path).size).toBe(bytes.length)
  } finally { source.stop(); source.mailbox.close(); source.store.close(); rmSync(root, { recursive: true, force: true }) }
})

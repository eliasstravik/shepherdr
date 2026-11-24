// Settings › Voice: the ElevenLabs key that Talk and dictation use, where people look for it. It is the same secret as
// Settings › Secrets' Everywhere ELEVENLABS_API_KEY (one key, two ways to set it); the old secrets/elevenlabs.env file,
// if a machine still has one, wins over both (core/voice.js voiceKey). The value goes from a masked box straight to the
// vault and never comes back: the page only hears whether it works (the service's voice-check, core/voice.js checkKey).
import { useEffect, useState } from 'react'
import { act, openSettings, tryAct, useStore } from '@client/kernel.ts'
import { confirm, openForm } from '@client/overlay.tsx'
import { Btn, I } from '@client/ui.tsx'
import { SRow } from '@client/settings.tsx'

export const NAME = 'Voice'
export const KEY = 'ELEVENLABS_API_KEY'

export type Check = { ok: boolean; says: string; state: 'works' | 'refused' | 'none' | 'unreachable'; from?: string }

/** the small print under "ElevenLabs key": the state in a few words */
export function stateWords(c: Check | null, kept: boolean, checking: boolean) {
  if (checking) return 'Checking…'
  if (!c) return kept ? 'Added' : 'Not added'
  if (c.state === 'works') return c.from === 'file' ? 'Works · from an old file' : 'Works'
  if (c.state === 'refused') return "Doesn't work"
  if (c.state === 'none') return 'Not added'
  return kept ? "Added · can't check now" : "Can't check now"
}

/** opens Settings › Voice: where a Talk or a dictation without a key leads */
export const openVoiceSettings = () => openSettings('all', NAME)

/** a message about a missing ElevenLabs key */
export const needsKey = (m: string) => /ElevenLabs key/i.test(m)

function keyForm(replace: boolean, done: () => void) {
  openForm(
    function Form({ close }) {
      const [v, setV] = useState('')
      const ok = async () => {
        if (!v.trim()) return
        close()
        if (await tryAct({ type: 'secret', level: 'all', name: KEY, value: v.trim() }, 'Saved')) done()
      }
      return (
        <>
          <h2>{replace ? 'Replace your ElevenLabs key' : 'Add your ElevenLabs key'}</h2>
          <p>Copy it from elevenlabs.io › Developers › API Keys. It's kept with your secrets and never shown again.</p>
          <label className="fld">
            <span>Key</span>
            <input className="inp" type="password" name="elevenlabs-key" value={v} autoComplete="off" spellCheck={false} data-autofocus onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void ok()} />
          </label>
          <div className="acts">
            <Btn onClick={close}>Cancel</Btn>
            <Btn kind="pri" onClick={() => void ok()}>Save</Btn>
          </div>
        </>
      )
    },
    { label: replace ? 'Replace your ElevenLabs key' : 'Add your ElevenLabs key' },
  )
}

export function VoiceSettings() {
  const kept = useStore((s) => !!s.snap?.config?.secrets.some((x) => x.name === KEY && x.scope === 'all'))
  const [c, setC] = useState<Check | null>(null)
  const [checking, setChecking] = useState(false)
  const test = async () => {
    setChecking(true)
    try {
      setC(await act<Check>({ type: 'voice-check' }))
    } catch (e) {
      setC({ ok: false, state: 'unreachable', says: (e as Error).message || "Couldn't ask Shepherdr. Try again." })
    }
    setChecking(false)
  }
  // checked once as the page opens, so it says the truth (a key in an old file, a key that stopped working)
  useEffect(() => void test(), [])
  const has = kept || (!!c && c.state !== 'none')
  const remove = () =>
    confirm({
      title: 'Remove your ElevenLabs key?',
      body: 'Talk and dictation stop working until you add one again.',
      ok: 'Remove',
      danger: true,
      run: async () => {
        if (await tryAct({ type: 'secret', level: 'all', name: KEY, value: null }, 'Removed')) void test()
      },
    })
  const bad = c && !checking && c.state !== 'works' && (c.state !== 'none' || has)
  return (
    <>
      <p className="hint">Talk and dictation use ElevenLabs, with your own key.</p>
      <SRow label={<>ElevenLabs key<small>{stateWords(c, kept, checking)}</small></>}>
        <Btn small kind={has ? undefined : 'pri'} onClick={() => keyForm(has, () => void test())}>{has ? 'Replace' : 'Add key'}</Btn>
      </SRow>
      {bad && (
        // the whole reason, every line of it (a banner's text stops at two lines)
        <div className="banner" role="status" style={{ alignItems: 'flex-start', paddingBlock: 10 }}>
          <I n="warn" c="c-ask" />
          <span className="n" style={{ display: 'block', WebkitLineClamp: 'unset' }}>{c.says}</span>
        </div>
      )}
      {c?.state === 'works' && !checking && c.from === 'file' && (
        <p className="hint">This key comes from an old file on the machine that serves Shepherdr (secrets/elevenlabs.env), which wins over the one here. Remove that file to use this one.</p>
      )}
      {has && (
        <div className="acts" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
          <Btn small disabled={checking} onClick={() => void test()}>{checking ? 'Testing…' : 'Test'}</Btn>
          {(kept || (!!c?.from && c.from !== 'file')) && <Btn small kind="danger" onClick={remove}>Remove</Btn>}
        </div>
      )}
    </>
  )
}

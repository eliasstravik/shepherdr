// What a machine can really run: its CLIs, installed and signed in, and Autopilot's sandbox. Asked of the CLIs themselves,
// so an API key, a keychain or a login file all count. Only yes or no comes back: their status also names the account.
export type CliState = 'ready' | 'signed-out' | 'missing'
export interface MachineCheck { at: number; platform?: string; sandbox?: 'ok' | 'missing' | 'blocked'; cli: { claude?: CliState; codex?: CliState } }

export const MACHINE_CHECK = `
limit=; if command -v timeout >/dev/null 2>&1; then limit='timeout 10'; fi
printf 'platform=%s\\n' "$(uname -s)"
if ! command -v bwrap >/dev/null 2>&1; then echo sandbox=missing
elif bwrap --unshare-all --ro-bind / / true >/dev/null 2>&1; then echo sandbox=ok
else echo sandbox=blocked; fi
if command -v claude >/dev/null 2>&1; then echo "claude=$($limit claude auth status </dev/null 2>/dev/null | grep -o '"loggedIn": *[a-z]*' | head -n 1)"; else echo claude=missing; fi
if command -v codex >/dev/null 2>&1; then echo "codex=$($limit codex login status </dev/null 2>&1 | grep -iE '^(not )?logged in' | head -n 1)"; else echo codex=missing; fi
`

const state = (word: string | undefined): CliState | undefined => {
  if (word === 'missing') return 'missing'
  if (/"loggedIn": *true|^logged in/i.test(word ?? '')) return 'ready'
  if (/"loggedIn": *false|^not logged in/i.test(word ?? '')) return 'signed-out'
}

/** An answer it can't read leaves that CLI unknown, never signed out. No platform: nothing ran, so no check at all. */
export function parseMachineCheck(text: string, at = Date.now()): MachineCheck | undefined {
  const words = Object.fromEntries(text.split('\n').flatMap(line => { const eq = line.indexOf('='); return eq > 0 ? [[line.slice(0, eq), line.slice(eq + 1).trim()]] : [] }))
  if (!words.platform) return undefined
  const sandbox = ['ok', 'missing', 'blocked'].includes(words.sandbox) ? words.sandbox as MachineCheck['sandbox'] : undefined
  return { at, platform: words.platform, ...(sandbox ? { sandbox } : {}), cli: { claude: state(words.claude), codex: state(words.codex) } }
}

export const sameCheck = (a: MachineCheck, b: MachineCheck) => a.platform === b.platform && a.sandbox === b.sandbox && a.cli.claude === b.cli.claude && a.cli.codex === b.cli.codex

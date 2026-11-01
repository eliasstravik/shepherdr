// What a machine can really run: its CLIs, installed and signed in, and Autopilot's sandbox. Asked of the CLIs themselves,
// so an API key, a keychain or a login file all count. Only yes or no comes back: their status also names the account.
export type CliState = 'ready' | 'signed-out' | 'missing'
export interface MachineCheck { at: number; platform?: string; sandbox?: 'ok' | 'missing' | 'blocked'; seatbelt?: 'ok' | 'missing'; bun?: string; quarantined?: string; cli: { claude?: CliState; codex?: CliState } }

export const MACHINE_CHECK = `
limit=; if command -v timeout >/dev/null 2>&1; then limit='timeout 10'; fi
printf 'platform=%s\\n' "$(uname -s)"
if [ -x /usr/bin/sandbox-exec ]; then echo seatbelt=ok; else echo seatbelt=missing; fi
if [ "$(uname -s)" = Darwin ] && c=$(command -v codex); then h="$(dirname "$(realpath "$c")")/codex-code-mode-host"; q=$(xattr -p com.apple.quarantine "$h" 2>/dev/null | cut -d';' -f1); if [ -n "$q" ] && [ $(( 0x$q & 0x40 )) -eq 0 ]; then echo "quarantined=$h"; fi; fi
b=$(command -v bun || { test -x "$HOME/.bun/bin/bun" && printf '%s\\n' "$HOME/.bun/bin/bun"; }); if [ -n "$b" ]; then echo "bun=$($limit "$b" --version </dev/null 2>/dev/null | head -n 1)"; fi
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
  const seatbelt = ['ok', 'missing'].includes(words.seatbelt) ? words.seatbelt as MachineCheck['seatbelt'] : undefined, bun = /^\d+\.\d+\.\d+/.test(words.bun ?? '') ? words.bun : undefined, quarantined = words.quarantined?.startsWith('/') ? words.quarantined : undefined
  return { at, platform: words.platform, ...(sandbox ? { sandbox } : {}), ...(seatbelt ? { seatbelt } : {}), ...(bun ? { bun } : {}), ...(quarantined ? { quarantined } : {}), cli: { claude: state(words.claude), codex: state(words.codex) } }
}

export const sameCheck = (a: MachineCheck, b: MachineCheck) => a.platform === b.platform && a.sandbox === b.sandbox && a.seatbelt === b.seatbelt && a.bun === b.bun && a.quarantined === b.quarantined && a.cli.claude === b.cli.claude && a.cli.codex === b.cli.codex

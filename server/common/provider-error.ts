// Native provider failure classification; no terminal or screen inference.
/** what a CLI's log says cut its turn off: the provider's words, and its own code and HTTP status where it has them */
export interface Cut {
  id: string
  at: number
  text: string
  code?: string
  status?: number
}

export interface ProviderError {
  /** it passes by itself: wait and try again */
  passing: boolean
  /** in a few words, for a status line: "Provider overloaded", "Out of allowance" */
  reason: string
}

const CODE_PASSING: Record<string, string> = {
  server_overloaded: 'Provider overloaded',
  overloaded: 'Provider overloaded',
  overloaded_error: 'Provider overloaded',
  model_cap: 'Model at capacity',
  http_connection_failed: 'Connection dropped',
  response_stream_connection_failed: 'Connection dropped',
  response_stream_disconnected: 'Connection dropped',
  response_too_many_failed_attempts: 'Connection dropped',
  internal_server_error: 'Provider server error',
  server_error: 'Provider server error',
}
const CODE_LASTING = ['unauthorized', 'bad_request', 'context_window_exceeded', 'usage_limit_exceeded', 'sandbox_error', 'authentication_failed', 'billing_error', 'invalid_request', 'model_not_found', 'max_output_tokens']
const WORDS_AUTH = /\b(?:status|error|HTTP)\b[^\n]{0,12}\b40[13]\b|\b401 Unauthorized\b|please run \/login|login expired|not logged in|oauth token/i
const WORDS_ALLOWANCE = /usage limit|(?<!rate.?)limit reached|hit your [\w ]*limit|\bquota\b|billing|credit balance|payment/i
const WORDS_LASTING = /not supported|unsupported|does not exist|may not exist|not found|unknown (?:provider|model)|invalid|context (?:window|length)|flagged|content policy/i
const WORDS_PASSING: [RegExp, string][] = [
  [/at capacity/i, 'Model at capacity'],
  [/rate.?limit|too many requests|\b429\b/i, 'Rate limited'],
  [/overloaded|\b529\b/i, 'Provider overloaded'],
  [/socket|connection|network|\bE(?:CONN\w+|TIMEDOUT|AI_AGAIN|PIPE)\b|timed? ?out|fetch failed|stream (?:ended|closed|disconnected|error)|disconnect/i, 'Connection dropped'],
  [/\b(?:API error|status|HTTP)\b[^\n]{0,12}\b5\d\d\b|internal server error|bad gateway|service unavailable|upstream|server error|you can retry your request|try again later/i, 'Provider server error'],
]

/** when an allowance comes back, as the provider says it ("resets 5pm", "try again at 5:00 PM"): " until 5pm" */
const until = (words: string) => {
  const m = words.match(/\bresets (?:at )?([^\n·.,;()]{1,24})|try again (?:at|after) ([^\n.,;()]{1,24})/i)
  const when = (m?.[1] ?? m?.[2])?.trim()
  return when ? ` until ${when}` : ''
}

/** which errors pass by themselves. The CLI's own code decides where it has one (Codex codex_error_info, Claude Code's
 *  error and HTTP status); its words decide for the rest. Not recognised: it doesn't pass. */
export function providerError(words: string, code = '', status = 0): ProviderError {
  const c = code.toLowerCase()
  const said = WORDS_PASSING.find(([re]) => re.test(words))?.[1]
  if (c === 'unauthorized' || c === 'authentication_failed' || status === 401 || status === 403 || WORDS_AUTH.test(words)) return { passing: false, reason: 'Signed out' }
  if (c === 'usage_limit_exceeded' || c === 'billing_error' || WORDS_ALLOWANCE.test(words)) return { passing: false, reason: `Out of allowance${until(words)}` }
  if (CODE_LASTING.includes(c) || (status >= 400 && status < 500 && status !== 408 && status !== 429) || WORDS_LASTING.test(words)) return { passing: false, reason: c === 'context_window_exceeded' || /context (?:window|length)|too long/i.test(words) ? 'Context window full' : c === 'model_not_found' || /model/i.test(words) ? 'Model not available' : 'Provider refused it' }
  if (CODE_PASSING[c]) return { passing: true, reason: said ?? CODE_PASSING[c] }
  if (status === 429 || c === 'rate_limit') return { passing: true, reason: 'Rate limited' }
  if (status === 408 || status >= 500) return { passing: true, reason: said ?? (status === 529 ? 'Provider overloaded' : 'Provider server error') }
  return said ? { passing: true, reason: said } : { passing: false, reason: 'Provider error' }
}


export const PROVIDER_WAITS = [1, 2, 4, 8].map(minutes => minutes * 60_000)

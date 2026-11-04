// The start of a message as a reaction or a reply quotes it: one line of plain words. The server quotes with it, and the
// screen shows a reply's quote with it at once, before the server has it.

export function excerpt(text: string, n = 60) {
  const one = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*(#{1,6}|>)\s+/gm, '')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return one.length > n ? `${one.slice(0, n - 1).trimEnd()}…` : one
}

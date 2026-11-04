/** Familiar Done archive interval. Invalid/off values never cause an automatic removal from the active list. */
export function archiveAfterMs(value: string) {
  const match = value.trim().match(/^(\d+)(\s*days?)?$/i)
  const days = Number(match?.[1])
  return match && Number.isSafeInteger(days) && days > 0 && Number.isSafeInteger(days * 86_400_000) ? days * 86_400_000 : null
}

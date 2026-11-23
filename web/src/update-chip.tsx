// "New version · Update": the chip a page on an old web app shows while it can't update by itself (SHEP-337, update.ts).
import { newerServed, updateNow, useStore } from './kernel.ts'
import { I } from './ui.tsx'

export function UpdateChip() {
  const newer = useStore(newerServed)
  const calling = useStore((s) => s.ui.call)
  if (!newer || calling) return null
  return (
    <button type="button" className="upchip" onClick={updateNow}>
      <I n="reload" c="s16" />
      New version · <b>Update</b>
    </button>
  )
}

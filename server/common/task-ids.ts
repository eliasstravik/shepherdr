import type { SettingSection } from '../../shared/types.ts'
export function taskIdsSection(level: string, machine: string, prefix: string, next: number): SettingSection {
  return {
    name: 'Task IDs', level, machine,
    about: 'For new tasks in this space. Existing IDs stay the same.',
    rows: [
      { label: 'Prefix', key: 'taskIds.prefix', value: prefix, text: true, hint: 'Capital letters and digits, starting with a letter. Unique on this machine.' },
      { label: 'Next number', key: 'taskIds.next', value: String(next), text: true, hint: `Next task: ${prefix}-${next}. Numbers can only move forward.` },
    ],
  }
}

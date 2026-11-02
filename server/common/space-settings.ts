import type { SettingSection } from '../../shared/types.ts'

/** A repository's destination; no machine or Everywhere fallback. */
export const repositorySection = (level: string, machine: string, base: string): SettingSection => ({
  name: 'Repository', machine, level,
  rows: [{ key: 'space.base', label: 'Base branch', value: base, text: true, hint: 'New tasks start from and merge into this branch. Existing tasks keep their target.' }],
})

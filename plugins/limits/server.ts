// Plan limits: what is left of the plans each machine's CLIs are signed in to, read from the CLIs themselves every ten
// minutes, or when asked (server/core/plan-limits.ts). Nothing goes through a running agent.
import { definePlugin } from '../../server/plugin-api.ts'

export default definePlugin({ name: 'limits', about: "Plan limits: how much of your Claude Code and Codex plans is left and when it refills, beside Settings" })

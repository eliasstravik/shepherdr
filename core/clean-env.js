// Agents never inherit a parent Claude Code session (SHEP-86). herdr-core's holder keeps the environment of whatever
// started it, and every terminal it runs gets that: a holder started from inside Claude Code hands each agent
// CLAUDECODE, CLAUDE_PID and CLAUDE_CODE_CHILD_SESSION, SESSION_ID, MESSAGING_*… Claude Code then turns transcript
// saving off ("inherited CLAUDE_CODE_CHILD_SESSION marker", the web Chat can't find the conversation) and skips the
// folder-trust prompt. hc can only add variables, never remove them, so each launch starts with this shell line:
// it unsets CLAUDECODE, CLAUDE_PID and CLAUDE_CODE_*, keeping the person's own Claude Code config
// (CLAUDE_CODE_USE_BEDROCK, _SKIP_*, _DISABLE_*, _OAUTH_TOKEN…, and CLAUDE_CONFIG_DIR, which never matches).
// POSIX sh (sed -E and grep -E work on GNU and macOS). The same line is in herdr-task (launch.py CLEAN_ENV) and
// mods/coordinator/restart.sh; test/test_repo.py keeps them equal.
export const CLEAN_ENV = `for v in $(env | sed -nE 's/^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_[A-Za-z0-9_]+)=.*/\\1/p' | grep -vE '^CLAUDE_CODE_(USE|SKIP|DISABLE|ENABLE|MAX|OAUTH|CLIENT|API)_'); do unset "$v"; done;`;

/** A template's `command:` (run by hc under sh -c) that clears those first, then execs the command (so the terminal's
 *  program is the agent, never sh: on dash the shell would otherwise stay). An `exec` it had is kept once. */
export const cleanCommand = (cmd) => `${CLEAN_ENV} exec ${String(cmd).trim().replace(/^exec\s+/, "")}`;

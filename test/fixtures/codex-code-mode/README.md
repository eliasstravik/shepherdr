
## Grouped polls (SHEP-218)

`grouped-polls.jsonl` is trimmed from SHEP-217's real Codex rollout on
2026-11-13. It retains command/poll order, session ids, exit codes and result
blocks. Command strings become `true`, stdout is empty, call ids are renamed,
and unrelated calls, image paths and script errors are removed. No commands
are executed by the replay. It includes the numeric for-of variable poll,
mixed command/poll results, and subsequent polls without a session id.

#!/usr/bin/env bash
# Restarts an agent in its own tab, optionally as another agent. The new one
# starts beside the old one (same tab labels), gets a short handoff, then the
# old one ends, so the tab keeps its name and place. A coordinator restarted
# without an argv runs the assistant template again (edited instructions apply).
# Its workers get herdr.coordinator=<tab> so they stay nested under the new one.
# Usage: restart.sh <old address> [argv as JSON array]
# Prints the new agent's address.
# For the chat mod (mods/chat), two optional environment variables:
#   HERDR_RESTART_CHAT=<chat pane>  the new agent starts parked behind that chat pane
#                                   (herdr.chat label) instead of getting a pane in the tab.
#   HERDR_RESTART_RESUME=1          argv resumes the same conversation: no handoff is sent.
set -u
old=$1 argv=${2:-}
# Another machine's agent (<machine>/<address>): this script runs there (its logs, templates and hc are
# that machine's), carried over hc like any cross-machine command; the new address comes back as
# <machine>/<address>, as this side names it.
if [[ "$old" == */* ]]; then
  on=${old%/*} here=${old##*/}
  envs=()
  [ -n "${HERDR_RESTART_CHAT:-}" ] && envs+=(--env "HERDR_RESTART_CHAT=$HERDR_RESTART_CHAT")
  [ -n "${HERDR_RESTART_RESUME:-}" ] && envs+=(--env "HERDR_RESTART_RESUME=1")
  out=$(hc exec --on "$on" --stdin --timeout 300 ${envs[@]+"${envs[@]}"} -- bash -s "$here" "$argv" <"$0" 2>/dev/null)
  code=$?
  new=$(tail -n 1 <<<"$out")
  if [ "$code" -ne 0 ] || [ -z "$new" ]; then
    state=$(hc machine ls --json 2>/dev/null | jq -r --arg m "${on%%/*}" '.machines[]? | select(.name == $m) | .state' 2>/dev/null)
    if [ -n "$state" ] && [ "$state" != connected ]; then echo "$on is offline. Try again once it's back." >&2
    else echo "It didn't restart on $on." >&2; fi
    exit 1
  fi
  echo "$on/$new"
  exit 0
fi
info=$(hc get "$old" --json) || exit 1
get() { jq -r "$1 // empty" <<<"$info"; }
space=$(get '.labels["herdr.space"]') tab=$(get '.labels["herdr.tab"]') role=$(get '.labels["herdr.role"]')
# Assistants start from the assistant template (earlier ones from "coordinator").
case $(get .template) in assistant|coordinator) role=coordinator ;; esac
cwd=$(get .cwd) app=$(get .status.app) pid=$(get .foreground.pid) created=$(get .created_ms)
# A parked agent (behind a chat) has no tab labels: the chat names where it goes instead.
# A coordinator in Chat mode says where it lives in its own labels (its workers name that tab).
[ -n "$tab" ] || tab=$(get '.labels["herdr.coordinator.tab"]')
[ -n "$space" ] && [ -n "$tab" ] || [ -n "${HERDR_RESTART_CHAT:-}" ] || [ -n "$(get '.labels["herdr.chat"]')" ] || exit 1

# What the previous agent did: its screen, and its session log when we can find it.
dir=${HERDR_APP_HOME:-$HOME/.config/herdr-app}/data/coordinator/handoff
mkdir -p "$dir"
screen="$dir/$old-$(date +%s).txt"
hc read "$old" --lines 400 >"$screen" 2>/dev/null
log=""
if [ "$app" = claude-code ] && [ -n "$pid" ]; then
  sid=$(jq -r '.sessionId // empty' "$HOME/.claude/sessions/$pid.json" 2>/dev/null)
  [ -n "$sid" ] && log=$(find "$HOME/.claude/projects" -name "$sid.jsonl" 2>/dev/null | head -1)
fi
if [ -z "$log" ] && [ -n "$created" ]; then
  log=$(find "$HOME/.claude/projects" "$HOME/.codex/sessions" "$HOME/.pi/agent/sessions" "$HOME/.local/share/opencode" \
      -type f \( -name '*.jsonl' -o -name '*.json' \) -newermt "@$((created / 1000))" 2>/dev/null \
    | xargs -r grep -l -F "\"$cwd\"" 2>/dev/null | xargs -r ls -t 2>/dev/null | head -1)
fi
was=${app:-the previous agent}
handoff="You are taking over this tab from $was ($old), which was restarted."
[ -n "$log" ] && handoff+=" Its session log is $log: read the recent part to pick up where it left off."
handoff+=" Its last screen is saved in $screen."

if [ "$role" = coordinator ]; then
  workers=$( { hc ls --json | jq -r --arg c "$old" '.terminals[] | select(.parent == $c) | .address'
    hc ls --json --label "herdr.coordinator=$tab" | jq -r --arg c "$old" '.terminals[] | select(.address != $c) | .address'; } | sort -u)
  if [ -n "$workers" ]; then
    list=""
    for w in $workers; do
      hc label "$w" "herdr.coordinator=$tab" >/dev/null 2>&1
      list+=" $w ($(hc get "$w" --json | jq -r '.name // .labels.where // ""'))"
    done
    handoff+=" Workers the previous coordinator started, still running:$list. They report to $old: watch each with hc wait <t> and tell each to report to you from now on."
  fi
fi

labels=(--label "herdr.space=$space" --label "herdr.tab=$tab")
[ "$role" = coordinator ] && labels+=(--label herdr.role=coordinator)
# An agent in Chat mode (parked behind a chat pane) restarts parked behind the same chat.
chat=${HERDR_RESTART_CHAT:-$(get '.labels["herdr.chat"]')}
# The label holds the pane as its own machine names it, never a window's "<machine>/<pane>" (#761).
chat=${chat##*/}
if [ -n "$chat" ]; then
  origin=$(get '.labels["herdr.chat.origin"]'); origin=${origin:-$old}
  labels=(--keep --label "herdr.chat=$chat" --label "herdr.chat.origin=$origin")
  # What a coordinator chat finds its agent by (mods/chat), and where the coordinator lives.
  for k in herdr.chat.slot herdr.coordinator.space herdr.coordinator.tab; do
    v=$(get ".labels[\"$k\"]"); [ -n "$v" ] && labels+=(--label "$k=$v")
  done
  [ "$role" = coordinator ] && labels+=(--label herdr.role=coordinator)
fi
# The new agent never inherits a parent Claude Code session's markers the holder may carry (SHEP-86):
# the same line as core/clean-env.js CLEAN_ENV (test_repo keeps them equal).
clean='for v in $(env | sed -nE '"'"'s/^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_[A-Za-z0-9_]+)=.*/\1/p'"'"' | grep -vE '"'"'^CLAUDE_CODE_(USE|SKIP|DISABLE|ENABLE|MAX|OAUTH|CLIENT|API)_'"'"'); do unset "$v"; done;'
tpl=$HOME/.config/herdr-core/templates/assistant.md
# A coordinator restarted without an argv: the assistant template's own command and words.
own=""
[ -z "$argv" ] && [ "$role" = coordinator ] && own=$(awk '/^---[[:space:]]*$/ {f++; next} f == 1 && sub(/^command:[ \t]*/, "") {print; exit}' "$tpl" 2>/dev/null)
# argv's words into cmd. A read loop, not mapfile: macOS's /bin/bash is 3.2, which has no mapfile (#736).
argv_cmd() { local a; cmd=(); while IFS= read -r a; do cmd+=("$a"); done < <(jq -r '.[]' <<<"$argv"); }
if [ -n "${HERDR_RESTART_RESUME:-}" ] && [ -n "$argv" ]; then
  argv_cmd
  [ ${#cmd[@]} -gt 0 ] || exit 1
  new=$(hc run --bg --json --no-parent --cwd "$cwd" "${labels[@]}" --label "herdr.agent=$(basename "${cmd[0]}")" -- sh -c "$clean"' exec "$@"' herdr-clean "${cmd[@]}" | jq -r '.address // empty')
elif [ -z "$argv" ] && [ "$role" = coordinator ] && [ -z "$own" ]; then
  new=$(hc run --bg --json --no-parent --cwd "$cwd" "${labels[@]}" assistant "$handoff" | jq -r .address)
else
  if [ -n "$own" ]; then
    own=${own#exec }
    line=$own key=$(basename "${own%% *}")
  else
    argv_cmd
    [ ${#cmd[@]} -gt 0 ] || exit 1
    key=$(basename "${cmd[0]}")
    # Codex runs its commands outside hc without --no-daemon.
    [ "$key" = codex ] && [[ " ${cmd[*]} " != *" --no-daemon "* ]] && cmd+=(--no-daemon)
    line=$(printf '%q ' "${cmd[@]}")
  fi
  msg=$handoff
  if [ "$role" = coordinator ]; then
    body=$(awk 'f>=2 {print} /^---[[:space:]]*$/ {f++}' "$tpl")
    msg="$body"$'\n\n'"$handoff"
  fi
  # hc delivers a template's first message once the agent is ready, so the
  # handoff goes in a one-off template, removed once it has started.
  one=herdr-handoff-$$
  file=$HOME/.config/herdr-core/templates/$one.md
  { printf -- '---\nname: %s\ndescription: A one-off Herdr handoff, removed after use.\ncommand: %s\n---\n' "$one" "$clean exec $line"
    printf '%s\n' "$msg"; } >"$file"
  out=$(hc run --bg --json --no-parent --cwd "$cwd" "${labels[@]}" --label "herdr.agent=$key" "$one")
  rm -f "$file"
  new=$(jq -r '.address // empty' <<<"$out")
  # Some agents (Codex's animated start) never settle for hc: send once it reports a status.
  if [ -n "$new" ] && [ "$(jq -r '.first_message.sent' <<<"$out")" = false ]; then
    hc wait "$new" --timeout 90 >/dev/null 2>&1
    hc send "$new" "$msg" >/dev/null 2>&1
  fi
fi
[ -n "$new" ] || exit 1
hc kill "$old" >/dev/null 2>&1
hc rm "$old" >/dev/null 2>&1
echo "$new"
exit 0

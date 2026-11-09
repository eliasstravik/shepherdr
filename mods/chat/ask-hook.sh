#!/bin/sh
# The PermissionRequest hook of Claude Code (~/.claude/settings.json) and Codex (~/.codex/hooks.json,
# and a task worker's own `herdr-task _allow`, which hands it what it doesn't allow itself, also on a
# machine that only runs tasks, where a sync keeps a copy in ~/.local/share/herdr/ask/): lets
# the person answer a permission, a question (AskUserQuestion) or a plan (ExitPlanMode) on the
# agent's chat card, wherever they read it: the window, the web app, a phone.
#
# In a Herdr terminal ($HC_TERMINAL_ID), it leaves the request in data/chat-asks/req/ and waits for
# the chat's answer in data/chat-asks/ans/, which it prints as it is: the hook's decision, or
# nothing (answer in the terminal). Any error, or no answer in time, also means no decision. It
# never decides by itself. It waits whether or not a chat shows the agent right now (SHEP-91: a
# person away from the window still gets the card on the web); only without hc and jq, when it
# can't tell the terminal answered, does it wait just while a chat's flag is fresh (the window's
# chat touches data/chat-asks/open/<terminal> every few seconds while it shows the agent).
#
# The terminal stays a way to answer. Claude shows its own prompt while this waits, and keeps
# the hook running when the prompt is answered there (typed in the terminal, by another agent's
# `hc send`), so the hook watches for that itself: once Claude's own status (OSC 7501, `hc get`)
# has been blocked and isn't any more, or the terminal ended, Claude no longer waits on it. It
# leaves what happened in data/chat-asks/end/<id> ("Answered in the terminal", from Claude's log
# when it can tell) for the chat's card, then goes, so every copy (the card, Needs you, the
# counts) closes at once. Codex shows its prompt only once the hook is done: the card's "Answer
# in terminal" (or the window showing the terminal) hands it back.

t="${HC_TERMINAL_ID:-}"
[ -n "$t" ] || exit 0
case "$t" in */*|*..*) exit 0 ;; esac
d="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/data/chat-asks"
flag="$d/open/$t"

# The chat's flag was touched in the last 15 seconds.
fresh() {
  m=$(stat -c %Y "$flag" 2>/dev/null || stat -f %m "$flag" 2>/dev/null) || return 1
  [ $(( $(date +%s) - m )) -le 15 ]
}
watch=0
command -v hc >/dev/null 2>&1 && command -v jq >/dev/null 2>&1 && watch=1
# Without hc and jq it can't see the terminal answered: only while a chat shows the agent.
[ "$watch" = 1 ] || fresh || exit 0
# A task worker runs its own hook too (herdr-task _allow: Codex's in its argv, Claude's in its
# --settings, SHEP-139), which hands this what it doesn't allow itself ($HERDR_ASK_CHAINED): the
# agent waits for both, so this copy steps aside. Codex's is inside a -c value (hooks.PermissionRequest=...),
# never a word of its own: matching only a bare "_allow" put two cards up for each ask (#866).
if [ -z "${HERDR_ASK_CHAINED:-}" ] && [ "$watch" = 1 ] \
  && hc get "$t" --json 2>/dev/null | jq -e '(.argv // []) as $a | ($a | index("_allow")) != null
       or any($a[]; tostring | startswith("hooks.PermissionRequest=") and contains(" _allow --command "))
       or (($a | index("--settings")) as $i | $i != null and (($a[$i + 1] // "") | tostring | contains(" _allow --command ")))' >/dev/null 2>&1; then
  exit 0
fi

id="$t.$(date +%s).$$"
req="$d/req/$id.json"
ans="$d/ans/$id.json"
end="$d/end/$id"
done_() { rm -f "$req" "$req.tmp" "$ans"; exit 0; }
# Over without a decision from here: why, for the card's quiet line, then go.
ended() { printf '%s\n' "$1" > "$end.tmp" 2>/dev/null && mv "$end.tmp" "$end" 2>/dev/null; done_; }
# Claude stops the hook itself when its prompt is refused or interrupted in the terminal.
trap 'ended "$(how declined)"' TERM INT HUP
mkdir -p "$d/req" "$d/ans" "$d/end" 2>/dev/null || exit 0
find "$d/end" -type f -mmin +1440 -delete 2>/dev/null
cat > "$req.tmp" 2>/dev/null && mv "$req.tmp" "$req" 2>/dev/null || done_

# Claude's own status now: blocked, working, idle, done; "gone" once the terminal ended.
status() {
  hc get "$t" --json 2>/dev/null | jq -r 'if .state == "live" then (.status | if type == "object" then .state else . end) // "" else "gone" end' 2>/dev/null
}
# How the prompt went, from Claude's log: the tool call this asks about and its result there
# (a refusal's result is written at once; an allowed call's only once it has run). $1: what
# no result there yet means.
how() {
  sleep 0.5
  r=$(python3 "$(dirname "$0")/ask-end.py" "$req" 2>/dev/null)
  case "${r:-$1}" in
    declined) echo "Declined or interrupted in the terminal" ;;
    *) echo "Answered in the terminal" ;;
  esac
}
armed=0

# Up to 30 minutes (the hook's timeout in settings.json is the same).
i=0
while [ "$i" -lt 6000 ]; do
  if [ -f "$ans" ]; then
    cat "$ans" 2>/dev/null
    done_
  fi
  if [ "$watch" = 1 ]; then
    case "$(status)" in
      blocked) armed=1 ;;
      gone) ended "Agent stopped" ;;
      working|idle|done) [ "$armed" = 1 ] && ended "$(how answered)" ;;
    esac
  else
    fresh || done_
  fi
  sleep 0.3
  i=$((i + 1))
done
ended "No answer here in 30 minutes; it waits in the terminal"

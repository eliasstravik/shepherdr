#!/bin/sh
# SessionStart hook (Claude Code's settings.json, Codex's hooks.json): inside Herdr only
# ($HC_TERMINAL_ID), tells the agent how the chat's reactions travel (mods/chat log.js).
# An Assistant also gets its "Your settings" block; every agent (Assistant, task worker, automation
# run, agent tab) gets Shepherdr's Reactions for its space: when and how to react, or never
# (herdr-task _session-note, which notes on its terminal what it was told). Outside Herdr it says nothing.
[ -n "${HC_TERMINAL_ID:-}" ] || exit 0
extra=""
if command -v herdr-task >/dev/null 2>&1; then
  extra=$(herdr-task _session-note "$HC_TERMINAL_ID" 2>/dev/null)
fi
note=$(cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Herdr chat: the person may react to your messages. A reaction arrives as a line like <hc from=\"person\" reaction=\"👍\" to=\"first words of your message\"/> (removed: reaction-removed=). Reactions need no reply: if one is all you got, answer only <hc no-reply/>. To react to the person's message, write a line of its own in the reply that ends your turn (a message before a tool call may be shortened, losing the line): <hc react=\"👀\" to=\"first words of their message\"/>. In to=, leave out double quotes or make them curly (“ ”). The chat shows these as reactions and hides the lines. A reply to one of your messages starts with <hc reply-to=\"first words of that message\"/>. A mention of a task (e.g. HAT-1) comes with a line <hc task=\"HAT-1\" title=… state=… folder=…>its prompt</hc>: that is the task they mean. Artifacts: to show the person something richer than text (a report, chart, board, form or proof), write a recipe (recipe.json, drawn in the window and on their phone) and publish it with herdr-artifact; run `herdr-artifact guide` first.
JSON
)
printf '%s%s"}}\n' "$note" "$extra"

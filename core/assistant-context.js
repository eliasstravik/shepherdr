// Claude Assistants get their editable role through a durable prompt file, never as a user message.
export function assistantContext(command, template) {
  if (!["assistant", "coordinator"].includes(template)) return null;
  const cmd = String(command ?? "").trim().replace(/^exec\s+/, "");
  const first = /^(?:'([^']*)'|"([^"$`\\]*)"|([^\s'"$`\\;|&<>()]+))(?=\s|$)/.exec(cmd);
  const program = first && (first[1] ?? first[2] ?? first[3]);
  if (!program || (program !== "claude" && !(program.startsWith("/") && program.endsWith("/claude")))) return null;
  const parts = cmd.match(/'[^']*'|"(?:\\.|[^"\\])*"|\\[\s\S]|[;&|<>()`\n\r]/g) ?? [];
  if (parts.some((p) => !["'", '"', "\\"].includes(p[0]))) return null;
  return `python3 "$HOME/.local/share/shepherdr/bin/herdr-assistant-context" "$HOME/.config/herdr-core/templates/${template}.md" -- ${cmd}`;
}

export function hasAssistantContext(argv) {
  return (argv ?? []).some((arg, i) => {
    const path = arg === "--append-system-prompt-file" ? argv[i + 1]
      : String(arg).startsWith("--append-system-prompt-file=") ? String(arg).slice("--append-system-prompt-file=".length) : null;
    return typeof path === "string" && /^\/.*\/herdr-core\/assistant-context\/[^/]+\.txt$/.test(path);
  });
}

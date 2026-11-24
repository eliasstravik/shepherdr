# Shortcuts and the command palette

**⌘K** on a Mac, **Ctrl+K** elsewhere, opens the palette: one box that finds anything (spaces, tasks, repos and
folders, artifacts, schedules, Settings pages) and runs any command. On a phone, the search button opens it.

- Empty, it shows your recent picks first, then what acts on the task in focus (its menu's rows, or the space's), then
  every command.
- Typing ranks everything by a loose match: "ot" finds Open Tasks.
- `>` keeps to commands, `#` to spaces, `@` to tasks.
- ↑ and ↓ move, Enter runs, Esc closes. Each row shows its shortcut.

**?** (or **⌘/**, **Ctrl+/**) shows every shortcut, by area. **Settings › Shortcuts** changes them.

## The defaults

⌘ is Ctrl off a Mac. "G then T" means press G, let go, then T.

| Area | Command | Keys |
|---|---|---|
| General | Search and commands | ⌘K |
| | Keyboard shortcuts | ? or ⌘/ |
| | Open Settings | ⌘, |
| | Show or hide the list | ⌘B |
| Go to | Open Tasks | G then T |
| | Open Artifacts | G then A |
| | Open Scheduled | G then S |
| | Go to Everything | G then E |
| | Go to the chat | G then C |
| Spaces | New space | ⌘⇧O |
| | Next / previous space | ⌥↓ / ⌥↑ |
| | Space 1 to 9 in the list | ⌥1 … ⌥9 |
| Chat | Write in the chat | R |
| | Change model or effort | ⌘⇧M |
| | Send, new line | Enter, ⇧Enter |
| Tasks | Next / previous task | J / K (Tasks open) |
| | New task (asks the space's Assistant) | C |
| | Mark as done and merge (a task waiting for you) | E |
| | Not now | H |
| | Stop the agent | ⌘. |
| | Maximize or minimize the task | F |
| | Rename the task | none |
| Terminal | Open your terminal | Ctrl+\` (Control on a Mac too) |
| | View as terminal | Ctrl+⇧+\` |
| Voice | Talk to Shepherdr | T |
| | Dictate | ⌘⇧Space |

Menus show a row's shortcut at its end. Shortcut hints hide where a finger is the pointer.

## Where keys go

- **Typing in a box:** single letters, `?` and G-then sequences stay text. Chords with ⌘, Ctrl or ⌥ still work.
- **A terminal or a screen you took over:** it keeps every key except ⌘K (the palette) and Ctrl+\` (your terminal),
  so the shell's Ctrl+B, Ctrl+K and Ctrl+L reach it.
- **A menu, dialog, the palette or Settings open:** single letters wait; chords still work.
- **The browser** keeps ⌘N, ⌘T, ⌘W (and with ⇧), ⌘Q and Ctrl+Tab: no page gets them, so none are used.

## Changing them

Settings › Shortcuts lists every command by area, with a search. Click a command's keys, then press the new ones
(two plain keys in a row make a G-then sequence; Esc cancels). If the keys are another command's, it says so and
**Use it here** moves them. If the browser keeps them, they can't be used; if the browser uses them too (⌘L, ⌘R),
it asks first. **×** removes a shortcut, **Reset** puts one back, **Reset all** every one. **Single-letter keys** turns
off every shortcut without ⌘, Ctrl or ⌥.

Changes are kept for you in `~/.config/shepherdr/settings.json`, the same on every device: `everywhere.shortcuts`
(`{"tasks.open": ["Mod+Shift+Y"]}`, `[]` for none) and `everywhere.shortcut_letters_off`. `Mod` is ⌘ on a Mac and
Ctrl elsewhere.

## For plugins

A plugin adds its commands in `setup` with `reg.commands.push({ id, title, area, keys, when, run })`
(`Command` in `web/src/kernel.ts`). Write keys for every computer: `Mod+K`, `Ctrl+\``, `Shift+/` (?), `G T`. `when`
says whether it can run now. `terminal: true` lets it fire from inside a terminal (keep that set small). A switched-off
plugin's commands are gone with it. The ids are what people's changed keys hang on: never rename one.

Where these came from: T3 Code (⌘K over commands and threads, `>` for commands, rows that show their keys, a
keybindings page with conflicts, the terminal keeping its Ctrl keys), Linear and GitHub (G-then go-to, `?` sheet, J/K,
actions on the item in focus), Superhuman (E done, H later, R reply), VS Code and Claude (Ctrl+\` terminal, ⌘/ sheet,
⌘⇧M model), Slack (⌥↑↓ between channels), Raycast (recent first, fuzzy match).

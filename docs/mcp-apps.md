# MCP Apps

When an agent calls an MCP tool that has a view (the [MCP Apps standard](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx),
2026-01-26), Shepherdr draws that view in the chat, under the call, on a computer and on a phone. Claude Code, Codex
or any agent that takes an MCP server on stdio.

## Set it up

Put `herdr-mcp` in front of the server, with the agent's own MCP command. The first word after `herdr-mcp` is the
server's name, then `--` and the command that starts the server:

```bash
claude mcp add flowbound -- herdr-mcp flowbound -- npx -y flowbound mcp
codex mcp add flowbound -- herdr-mcp flowbound -- npx -y flowbound mcp
```

Restart the agent. Its calls to that server's tools now show their views in the chat. Nothing else changes for the
agent: it sees the same tools and gets the same answers.

`--scope user` (Claude Code) puts it in every folder; Codex's `codex mcp add` is global already:

```bash
claude mcp add --scope user flowbound -- herdr-mcp flowbound -- npx -y flowbound mcp
```

### Folders with their own MCP config

Many tools write their own MCP config into a folder (`flowbound init` writes `.mcp.json` and `.codex/config.toml`),
often under the same name as yours. The agent then runs the folder's plain copy, not yours behind `herdr-mcp`, and no
view shows. Shepherdr covers that itself: while MCP Apps is on, every agent it starts (tasks and Assistant chats,
Claude Code and Codex, on this computer and on other machines) gets each of its stdio MCP servers behind `herdr-mcp`,
the folder's ones too. Nothing to set up per folder, and nothing in the folder changes (no git diff):

- **Claude Code**: the folder's `.mcp.json` servers (found from the folder up, as Claude Code finds them) go to the
  agent as `--mcp-config <file>`, each as `herdr-mcp <name> -- <its command>`, with the same name, args and env. A
  server given that way wins over the folder's. Only servers you approved (`enabledMcpjsonServers` or
  `enableAllProjectMcpServers` in Claude Code's settings, never one in `disabledMcpjsonServers`); a new one stays for
  Claude Code to ask about, and is covered from the next start once you say yes. Your own `claude mcp add` servers
  (user or local scope) aren't read: Shepherdr never opens `~/.claude.json`, which holds your sign-in too, so add those
  with `herdr-mcp` as above. If one of those has the same name as a folder's, the folder's (wrapped) one runs.
- **Codex**: Shepherdr asks Codex itself (`codex mcp list --json`, in the folder, with the agent's own `-c` and
  `--profile`) which servers it will run, from your config and a trusted folder's `.codex/config.toml`, and starts
  it with `-c mcp_servers.<name>.command=herdr-mcp -c mcp_servers.<name>.args=[<name>, "--", …]`: env, cwd and the
  rest stay from the config. A folder you haven't trusted stays out, as Codex keeps it out.
- Never twice (a server already behind `herdr-mcp` stays as it is), never an HTTP or SSE server, and a restart takes
  the last start's wrap out before adding it again. The generated `--mcp-config` files are kept in the service's
  folder (`mcp-apps/launch/`, readable only by you: a server's env may hold a key).
- MCP Apps off: agents start as they are. Other machines hear it from the service (`herdr-mcp --switch on|off`, sent
  when it changes, and again every minute until a machine that was offline gets it).

How: each start runs `herdr-mcp --wrap -- <agent command>` in the agent's folder on its machine just before the agent
starts (`service/mcp/wrap.ts`); without `herdr-mcp` there, or if anything fails, the agent starts as it was.

### On another machine

The same commands work on a machine the Shepherdr service reaches over its machine links (a VM): `herdr-task
machines sync` (and every update) puts `herdr-mcp` there with the other tools, in `~/.local/bin`. It runs on Bun, or
on Node when there is no Bun. Views from agents there show in the chat like any other: the service reads them over
the machine link, and a view's own calls go back to that machine's gateway after the same yes.

## What you see

- A card under the call: the server and tool, then the view, as high as the view asks.
- The expand button (or the view's own) shows it full screen; the shrink button or Esc brings it back.
- A view that has nothing to show for a call (it reports no height) folds away.
- A view that wants to run a tool asks first: **Allow once**, **Always** (that tool, from then on) or **No**.
- A view's words for the chat go into the message box for you to send; a link it opens asks first when the browser
  blocks it.
- Once the agent stops, its views stay, read only: their own calls need the agent's link to the server.
- **Always** is per server and machine: the same server name on another machine asks again.

## How it works

```text
agent ──stdio── herdr-mcp ──stdio── the MCP server
                   │ keeps each call to a tool with a view, and the view's HTML (resources/read)
                   │ listens on a socket for the view's own calls
Shepherdr service ─┘ /api/mcp-apps/<id>: the call, its HTML, its sandbox, the view's calls
web app: the chat finds the call by server, tool, input and time; draws the view in a sandbox

agent on another machine ── herdr-mcp there (keeps its calls there)
                               │ herdr-mcp --list / --get / --html / --call, run there over herdr-core's machine link
Shepherdr service ─────────────┘ /api/mcp-apps/on/<machine>/<id>: the same, read there; the yes is asked here
```

- `service/mcp/gateway.ts`: the gateway. Its initialize says the host shows `text/html;profile=mcp-app` views
  (`capabilities.extensions["io.modelcontextprotocol/ui"]`); `tools/list` leaves out tools only a view may call
  (`visibility: ["app"]`). Calls are kept in the service's folder (`mcp-apps/`), 30 days.
- `service/mcp-apps.ts`: the routes. The sandbox proxy is served with a CSP `sandbox` header and no
  `allow-same-origin`, so it has no origin of its own and can't reach the app's. The view runs in its inner frame under
  the CSP its resource declares (`_meta.ui.csp`), never wider than the spec's restrictive default plus those origins.
  Only clipboard writing is granted of the permissions a view may ask for.
- `web/plugins/mcp-apps/bridge.ts`: the host's side of the postMessage bridge: `ui/initialize` (host capabilities,
  theme, display modes, size), tool input and result, `tools/call` and `resources/read` through the gateway,
  `ui/open-link`, `ui/message`, `ui/request-display-mode`, size changes and teardown.
- `service/mcp/remote.ts`: another machine's calls. Every 10 s, while a page is open, it asks each linked machine for
  the calls started since the last it saw (`herdr-mcp --list <since>`), so that machine's chats find their views; a
  view's data, HTML and calls are read there when the page asks. Over herdr-core's `machine.exec` only, the link
  the service already uses for other machines' tasks and artifacts: private, never public.
- `herdr-mcp` on other machines: `bun run build` makes `web/dist/herdr-mcp.mjs`, one file with no Bun in it;
  `herdr-task machines sync` copies it and the launcher to `~/.local/share/herdr/mcp/`, linked from `~/.local/bin`.
- Not yet: servers over HTTP that need their own sign-in, and `ui/update-model-context` reaching the agent.

The switch: Settings › Plugins › MCP Apps.

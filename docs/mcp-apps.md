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

## What you see

- A card under the call: the server and tool, then the view, as high as the view asks.
- The expand button (or the view's own) shows it full screen; the shrink button or Esc brings it back.
- A view that has nothing to show for a call (it reports no height) folds away.
- A view that wants to run a tool asks first: **Allow once**, **Always** (that tool, from then on) or **No**.
- A view's words for the chat go into the message box for you to send; a link it opens asks first when the browser
  blocks it.
- Once the agent stops, its views stay, read only: their own calls need the agent's link to the server.

## How it works

```text
agent ──stdio── herdr-mcp ──stdio── the MCP server
                   │ keeps each call to a tool with a view, and the view's HTML (resources/read)
                   │ listens on a socket for the view's own calls
Shepherdr service ─┘ /api/mcp-apps/<id>: the call, its HTML, its sandbox, the view's calls
web app: the chat finds the call by server, tool, input and time; draws the view in a sandbox
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
- Not yet: servers over HTTP that need their own sign-in, `ui/update-model-context` reaching the agent, and agents on
  another machine (their gateway keeps the calls there).

The switch: Settings › Plugins › MCP Apps.

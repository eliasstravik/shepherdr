# Develop

Read [AGENTS.md](../AGENTS.md). On the shared agent VM, run only `bun run typecheck`.
Do not run local test suites, browser suites or full build checks. Inspect UI changes
by hand in the shared browser. GitHub runs the suites and production build.

The rewrite branch's [Core rewrite workflow](../.github/workflows/core-rewrite.yml)
checks this integration branch without deploying main. The Check workflow remains
the full check on every pull request to main and after each merge. Neither installs
services, changes private sharing, migrates state or publishes a release.

Use [isolated preview startup](core/start.md), with a separate home, port and core
session. Never use live `~/.shepherdr` for development. The optional fictional demo
uses `SHEPHERDR_SOURCE=demo bun server/main.ts`; it is UI fixture data, not acceptance
proof. Its optional browser is local-only, without any remote sharing or SSH code.
Vite can proxy an isolated app through `SHEPHERDR_API_URL`.
Codex keeps one trust fingerprint per hook slot for all Shepherdr installs, so trusting hooks in a second checkout
untrusts the first; a preview or moved checkout will do this.

```text
server/core/       core client, product state, tasks and standalone lifecycle
server/common/     shared log readers, parsers, vault and demo formatting
server/demo/       fictional UI world and optional local demo browser
server/app.ts      private HTTP/WebSocket app
src/               existing screen kernel and shared presentation
plugins/           built-in plugin parts
helper/core-*.ts   immutable authenticated helpers executed through core
bin/shepherdr      standalone lifecycle/human control or authenticated agent mailbox
bin/agent-browser  pinned shared-browser wrapper
skill/             agent and coordinator guides
```

Write meaningful unit, integration and layout regressions for GitHub. New UI cases
belong in their topic's `layout-*.test.ts` file. Core protocol fakes test boundaries;
they do not replace real native-agent or device acceptance.

Task IDs and workflow records live in the selected application's private SQLite
store. Prefix/next-number changes are per repository space and only move forward.
No 2.0 JSON/task-ID import is performed. See [state and cutover](core/cutover.md).

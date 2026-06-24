# omnigent-vscode

VS Code extension that brings **Omnigent** into the editor: an Omnigent panel plus native editor
commands (open/switch session, send selection, view/apply diffs).

## How the panel renders

By default the panel **iframes your running Omnigent server** (`renderMode: "iframe"`). The extension
auto-discovers a local server (or uses `omnigent.serverUrl`) and loads it directly — the same UI you
see at `http://127.0.0.1:6767`. This needs no separate web-app bundle.

- The iframe path is used for **local** servers (no token ever goes in a URL).
- `renderMode: "embed"` selects the experimental in-process embed bundle (requires building
  `media/apweb/` via `scripts/build-apweb.md`); it is not required for normal use.

## Opening the panel

- Command **“Omnigent: Open”** (`omnigent.open`) or the rocket button on the panel title bar.
- `omnigent.panelLocation` controls where it opens:
  - `"editor"` (default) — opens as a webview pane **beside the editor** (`ViewColumn.Beside`).
    This is the same mechanism the Claude Code extension uses for its conversation pane, so it
    lands reliably on the right.
  - `"right"` — targets the right **secondary side bar**. VS Code does not let an extension force
    this placement, so it is best-effort: the first time, enable the secondary side bar
    (View → Appearance → Secondary Side Bar, `⌥⌘B`) and drag the Omnigent view into it — VS Code
    then remembers it permanently.
  - `"left"` — the activity-bar sidebar (original location).

## Sessions

“Omnigent: Open / Switch Session” creates a session against the server. Session create requires an
**agent**: set `omnigent.defaultAgentId` to skip the prompt, otherwise the extension lists agents
(`GET /v1/agents`) and lets you pick one. (Sending `agent_id` is what avoids the prior `422`.)

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `omnigent.serverUrl` | `""` | Manual server URL override; empty = auto-discover local. |
| `omnigent.token` | `""` | Optional bearer override (prefer the CLI token file). |
| `omnigent.renderMode` | `iframe` | `iframe` (default) or `embed`. |
| `omnigent.panelLocation` | `editor` | `editor` (beside editor, like Claude Code) \| `right` (secondary side bar, best-effort) \| `left`. |
| `omnigent.defaultAgentId` | `""` | Skip the agent picker on session create. |
| `omnigent.defaultAgentName` | `""` | Agent name fallback when no id is set. |

## Build / test / package

```
npm install
npm run type-check   # tsc --noEmit
npm run test         # vitest run
npm run build        # esbuild -> dist/extension.js
npx @vscode/vsce package   # -> omnigent-vscode-<version>.vsix   (or: make package-vscode)
```

The `.vsix` runtime is `dist/extension.js` + `media/`. The default iframe render path is fully
contained in `dist/extension.js`, so `media/apweb/` is only needed for the optional `embed` mode.

## Layout

```
src/
├── extension.ts          # activate()/deactivate() — wires config/discovery/auth, panel, commands
├── api/client.ts         # /v1 REST client (sessions, agents, events, diffs, SSE)
├── commands/             # openSession (agent picker), openPanel (omnigent.open), sendSelection, diffs
├── panel/                # OmnigentViewProvider, host.ts (shared render), iframeHtml.ts, csp.ts, html.ts (embed)
├── config/               # settings + server-target/host-type resolution
├── discovery/            # local-server discovery (pidfile/health/liveness)
└── auth/                 # token resolution + auth lifecycle
```

The discovery/auth contract is `../docs/discovery-auth.md` with shared conformance vectors in
`../docs/conformance/*.json` (kept in sync with the IntelliJ implementation).

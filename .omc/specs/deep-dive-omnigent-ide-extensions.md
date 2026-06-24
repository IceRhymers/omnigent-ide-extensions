# Spec: Omnigent IDE Extensions (VS Code + IntelliJ/PyCharm)

## Goal
Build IDE extensions that bring **Omnigent** (`github.com/omnigent-ai/omnigent`) into VS Code and the
JetBrains family (IntelliJ IDEA / PyCharm). Each extension **embeds Omnigent's existing web UI** in an
in-IDE panel pointed at a **configurable server target** — an auto-discovered local server
(`http://localhost:6767`) or a remote/managed server (e.g. hosted in Databricks) — and adds a thin layer of
**native editor commands**. The local-vs-managed choice is a server-URL + auth-mode configuration concern,
**not** an architectural fork: the same extension talks to the same `/v1` surface regardless of where the
server runs.

**Sequencing:** Ship **VS Code first** (shares TS with the web UI, simpler webview model) as the reference
implementation, then port the embed + native-command pattern to the **IntelliJ Platform** (Kotlin + JCEF).

## Architecture (decided)
- **Embed-first hybrid.** Core chat / tool-call / reasoning / elicitation / **terminal** experience is the
  embedded Omnigent web UI (full parity, no UI re-implementation). A thin native layer adds editor-native
  commands.
- **VS Code:** a `WebviewView` (activity-bar tool window) hosts the embedded UI. The extension is responsible
  for the Webview **Content-Security-Policy** — it must allow `frame-src`/`connect-src` to the configured
  server origin **and `ws(s)://` for terminals** (Omnigent terminals use WebSockets).
- **IntelliJ/PyCharm:** a `ToolWindow` hosts a **JCEF** browser (full Chromium → WebSockets work natively)
  showing the same UI; native actions in Kotlin/Java.
- **Server target:** the embedded UI loads from the server root (the SPA is mounted at `/`) and deep-links to a
  session via `/c/:conversationId`. No CSP/X-Frame/CORS headers on the server block embedding (verified in trace).

## Constraints
- **Reuse, don't rebuild.** No re-implementation of the Omnigent chat UI; embed the maintained `ap-web` SPA.
  (If/when a native client is needed later, `ap-web/src/lib/{sse,events,blocks,blockStream,types}.ts` are
  isomorphic and liftable — see Non-Goals.)
- **Full parity including interactive terminals** (WebSocket transport must work end-to-end in both IDE panels).
- **Credential/config strategy:** auto-discover the local server via `~/.omnigent/local_server.pid`
  (PID + port) + `GET /health`; reuse the existing token from `~/.omnigent/auth_tokens.json` (mode 0600);
  shell out to the `omnigent` / `databricks` CLI for login when needed (Databricks-fronted servers store a
  *pointer record* and mint fresh OAuth via `databricks auth login`). Always provide a **manual override**:
  a server-URL setting (+ optional bearer token) in extension settings.
- **Auth transport:** present `Authorization: Bearer <jwt>` for CLI-style clients; cookie/OIDC/header modes are
  the server's concern. The extension must handle 401/403 by prompting login / re-discovery.
- **Distribution:** ship from this open-source repo as **buildable artifacts** (VS Code `.vsix`, JetBrains
  plugin `.zip`) with manual-install instructions. **No marketplace publishing in v1.**
- **Tooling:** VS Code extension in **TypeScript** (`@types/vscode`, `vsce` for packaging). IntelliJ plugin via
  the **IntelliJ Platform Gradle plugin** (Kotlin), targeting IDEA + PyCharm (Community + Professional).
- Target reasonably recent IDE baselines (VS Code engine + a current IntelliJ Platform `sinceBuild`); pin exact
  versions during planning.

## Non-Goals (v1)
- A fully **native** (non-embedded) chat UI in either IDE — deferred; revisit by lifting `ap-web/src/lib/*.ts`
  (and a JVM SSE client for IntelliJ).
- **Server lifecycle controls** (start/stop/restart the local server, switch targets) from inside the IDE —
  deferred; v1 only *discovers* a running server and supports a manual URL override.
- **Marketplace publishing** (VS Code Marketplace / JetBrains Marketplace).
- Deploying or provisioning the Omnigent server / managed sandboxes themselves (handled by Omnigent's existing
  CLI/deploy paths).
- A published TS/JS or JVM Omnigent SDK package.

## Native editor commands (v1 must-haves)
1. **Send selection / file to agent** — command-palette + context-menu action that sends the current selection
   or active file (with workspace-relative path context) into the active Omnigent session (via the embedded UI
   bridge or `POST /v1/sessions/{id}/events`).
2. **Open / switch session panel** — command + activity-bar/tool-window entry to open the embedded UI and
   start or resume a session; a status indicator for server-connection state (connected / disconnected / which
   target).
3. **Open changed files / apply diffs** — surface files the agent changed and review/apply them using the IDE's
   **native diff viewer**.

## Acceptance Criteria
- [ ] **VS Code extension** packages to a `.vsix`, installs, and shows an Omnigent tool window embedding the
      web UI from the configured/discovered server.
- [ ] Local-server **auto-discovery** works: reads `~/.omnigent/local_server.pid`, verifies via `GET /health`,
      and connects without manual config when a local server is running.
- [ ] **Manual override** works: setting a server URL (+ optional token) connects to a remote/Databricks-hosted
      server; auth failures (401/403) prompt a clear re-login/override path.
- [ ] **Interactive terminals stream** inside the panel (WebSocket connectivity verified; Webview CSP permits
      `ws(s)://` and the server origin).
- [ ] Chat, tool calls, reasoning, and elicitation/approval flows render correctly via the embedded UI.
- [ ] All three **native commands** function: send selection/file, open/switch session, open changed files +
      apply diffs through the IDE's diff viewer.
- [ ] **IntelliJ/PyCharm plugin** builds to a plugin `.zip`, installs in IDEA + PyCharm, and reaches feature
      parity (JCEF tool window + the same three native actions).
- [ ] Repo contains build + manual-install instructions for both artifacts.

## Assumptions Exposed
- Repo layout: a monorepo with `vscode/` and `intellij/` (and possibly a small shared `core/` for
  discovery/auth/config logic where language permits) — **to be confirmed in planning**.
- The embedded UI can be pointed at an arbitrary server origin purely via the loaded URL (local or remote);
  cross-origin asset loading in the Webview/JCEF is acceptable, or the extension proxies as needed.
- Databricks-hosted Omnigent is reached as a normal remote server URL; the `databricks` CLI is available on the
  user's machine for the login/OAuth path when targeting Databricks-fronted servers.
- Users have Omnigent installed locally (for the auto-discovery path) per its standard install.

## Technical Context (from trace)
- **REST:** `POST /v1/sessions` (create), `GET /v1/sessions/{id}` (snapshot), `POST /v1/sessions/{id}/events`
  (`message` / `interrupt` / `stop_session` / `compact` / `slash_command`), `GET /v1/sessions/{id}/stream`
  (SSE live tail, terminates on `data: [DONE]`), `GET /api/agents`.
- **SSE taxonomy:** `response.*` (created / in_progress / output_text.delta / reasoning.* / output_item.done /
  error / elicitation_request / …) and `session.*` (status / usage / todos / sandbox_status / presence / …).
- **Embed surface:** `ap-web/src/embed.tsx` exposes `OmnigentApp` + `OmnigentHostConfig` (`fetcher`,
  `resolveWebSocketUrl`, `cliServerUrlSuffix`, `basename`) for same-root embedding; SPA also works standalone at
  the server root with deep-link routes `/c/:conversationId`. No CSP / X-Frame-Options / frame-ancestors / CORS
  headers on the server (`omnigent/server/app.py`).
- **Auth modes:** header (`X-Forwarded-Email`, used by Databricks Apps), OIDC (cookie `__Host-ap_session`),
  accounts (cookie + password); CLI clients use `Authorization: Bearer <jwt>`.
- **Local server:** pidfile `~/.omnigent/local_server.pid`, default port 6767, `/health` probe; daemon spawns
  with `OMNIGENT_LOCAL_SINGLE_USER=1`. Config at `~/.omnigent/config.yaml`; tokens at
  `~/.omnigent/auth_tokens.json` (0600).
- **No published TS/JS SDK** — only Python `omnigent-client` on PyPI. The `ap-web` TS stream client is internal
  but isomorphic/liftable.

## Trace Findings
- **Most likely path:** hybrid embed-first across both IDEs with a configurable server target — confirmed and
  adopted as the architecture.
- **Lane 1 unknown (embed vs native) → resolved:** hybrid embed + native commands; native UI deferred.
- **Lane 2 unknown (terminals/embed style) → resolved:** include terminals (WebSocket parity); embed the
  maintained SPA rather than re-implementing.
- **Lane 3 unknown (discovery/auth) → resolved:** auto-discover local via pidfile/health + reuse
  `~/.omnigent/auth_tokens.json` + CLI login (incl. `databricks`), with a manual server-URL/token override.
- Evidence that shaped the spec: server embeds freely (no blocking headers), WebSockets required for terminals
  (Webview CSP is the extension's responsibility), and the local/managed distinction is configuration-only.

## Interview Transcript (summary)
1. Trace lanes confirmed (API surface / embed-vs-native / local-vs-managed auth).
2. UI approach → **Hybrid: embed UI + native commands.**
3. Terminals → **Include terminals (WebSocket parity).**
4. Auth/config → **Reuse `~/.omnigent` + CLI, with manual override.**
5. Sequencing → **VS Code first, then IntelliJ/PyCharm.**
6. Distribution → **Open-source repo, buildable artifacts, manual install (no marketplace in v1).**
7. Native commands → **Send selection/file; Open/switch session panel; Open changed files + apply diffs**
   (server lifecycle controls deferred).

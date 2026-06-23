# Deep Dive Trace: omnigent-ide-extensions

## Observed Result / Goal
Build VS Code and IntelliJ/PyCharm extensions for **Omnigent** (`github.com/omnigent-ai/omnigent`),
an open-source AI-agent framework + meta-harness. Omnigent runs both **locally** (FastAPI server
+ embedded web UI at `http://localhost:6767`) and **managed** (deployable server that can provision
cloud sandboxes per session). The extensions should be configurable to point at either the local
embedded web UI or a managed session hosted in a web UI (e.g. hosted in Databricks).

## Ranked Hypotheses (integration approaches)
| Rank | Approach | Confidence | Evidence Strength | Why it leads |
|------|----------|------------|-------------------|--------------|
| 1 | **Embed the existing web UI** in an IDE webview (VS Code Webview / IntelliJ JCEF), pointed at a configurable server URL (local or remote/Databricks) | High | Strong | Web UI is a self-contained SPA mounted at `/`; **no CSP / X-Frame-Options / frame-ancestors** headers block embedding; ap-web ships an explicit embed surface (`embed.tsx` → `OmnigentApp` + `OmnigentHostConfig`); deep-linkable routes `/c/:conversationId`. Thinnest extension, full feature parity, zero UI re-implementation. |
| 2 | **Native IDE-native UI** built on the REST/SSE API, reusing the liftable TS stream client | Medium | Moderate | `ap-web/src/lib/{sse,events,blocks,blockStream,types}.ts` are isomorphic, zero browser-only deps (WHATWG `ReadableStream`), directly portable into a VS Code (Node) extension. But no published TS/JS SDK exists today (only Python `omnigent-client` on PyPI), and JVM (IntelliJ) would need its own client. High effort, best editor integration. |
| 3 | **Hybrid**: embed web UI for chat/terminals (v1) + add thin native affordances (status bar, "send selection/file to agent", open-session command) | High | Moderate | Best ROI: embed gives instant parity; native commands give editor-native ergonomics without re-building the chat UI. |

## Evidence Summary by Lane
- **Lane 1 — API/SSE surface**: REST is `POST /v1/sessions` (create), `GET /v1/sessions/{id}` (snapshot),
  `POST /v1/sessions/{id}/events` (message / `interrupt` / `stop_session` / `compact` / `slash_command`),
  `GET /v1/sessions/{id}/stream` (SSE live tail, terminates on `data: [DONE]`), `GET /api/agents` (list).
  SSE event taxonomy is rich: `response.*` (created/in_progress/output_text.delta/reasoning.*/output_item.done/
  error/elicitation_request/…) and `session.*` (status/usage/todos/sandbox_status/presence/…). The TS reducer
  `blockStream.ts` mirrors Python `_stream.py` and is liftable as-is. **No published TS SDK** — Python only.
- **Lane 2 — Embed vs native**: SPA served at server root (`omnigent/server/app.py:1817-1847`), HTML5 history
  fallback (`_SPAStaticFiles`), client routes deep-link sessions (`/c/:conversationId`). **No CSP / X-Frame /
  CORS headers found** → embeds freely. `embed.tsx` exposes `OmnigentApp` + `OmnigentHostConfig` (`fetcher`,
  `resolveWebSocketUrl`, `cliServerUrlSuffix`, `basename`) for same-root embedding with host-controlled
  transport/theme. No existing IDE integration in the repo.
- **Lane 3 — Local vs managed / Databricks auth**: Auth modes = **header** (trusted proxy `X-Forwarded-Email`,
  used by Databricks Apps), **OIDC** (cookie `__Host-ap_session`), **accounts** (cookie + password); CLI clients
  use `Authorization: Bearer <jwt>`. `omnigent login <url>` stores a JWT in `~/.omnigent/auth_tokens.json`
  (0600). For **Databricks-fronted** servers it stores a *pointer record* (no token) and mints fresh OAuth via
  `databricks auth login`. Local server: pidfile `~/.omnigent/local_server.pid` (PID + port), default port 6767,
  `/health` probe, `local_server_url_if_healthy()`, daemon spawns with `OMNIGENT_LOCAL_SINGLE_USER=1`.
  Managed hosts: server provisions cloud sandbox per session (Modal/Daytona/Islo/E2B) via
  `POST /v1/sessions {host_type: managed}`. Databricks = model provider (`databricks` extra, `~/.databrickscfg`)
  and deploy-as-Databricks-App (header auth). Config in `~/.omnigent/config.yaml`.

## Evidence Against / Missing Evidence
- **Embed (H1)**: Terminals use **WebSockets** — embedded webview must resolve WS URL + auth (`resolveWebSocketUrl`
  override exists, but full WS auth flow in embedded mode not traced). VS Code Webview CSP is set by the *extension*,
  not the server, so the extension must allow-list the frame/connect sources itself.
- **Native (H2)**: No published TS SDK; JVM client must be written from scratch; re-implementing chat/tool/terminal
  rendering is a large surface that already exists in ap-web.
- **Hybrid (H3)**: Requires both an embed host and a small native command layer + the same auth/config plumbing.

## Per-Lane Critical Unknowns
- **Lane 1 (API/native client)**: For v1, is **embed-only** acceptable, or do we need a native client (and therefore
  a lifted/published TS SSE client, plus a JVM client for IntelliJ)?
- **Lane 2 (embed/UI)**: Do the extensions need **interactive terminals** (WebSocket) in v1, or is chat + tools +
  files enough — and should we use iframe-style embedding vs the `OmnigentApp` same-root embed surface?
- **Lane 3 (runtime/auth)**: How should the extension **discover the local server and acquire credentials** —
  reuse `~/.omnigent/auth_tokens.json` + the pidfile, shell out to the `omnigent`/`databricks` CLI, or require the
  user to paste a server URL + token? And for the Databricks-hosted case, how heavily do we lean on the Databricks CLI?

## Lane 3 Misplacement / SoT Ownership Scope
Not applicable — this is a greenfield build with no MOVE candidates.

## Rebuttal Round
- **Best rebuttal to leader (embed):** "Embedding a full SPA in a webview is heavy and gives little editor-native
  value over just opening the browser." → Held partially: the unique value is *in-IDE presence* + native commands
  (send selection/file, jump to changed files), which H3 captures. Pure embed (H1) without native commands is only
  marginally better than a browser tab, so the recommendation tilts toward **H3 (hybrid)**.
- **Why leader held:** No re-implementation of the rich, already-built chat/tool/elicitation UI; instant parity
  with the maintained web UI; the embed surface is a first-class, intended extension point.

## Convergence / Separation Notes
- H1 and H3 converge on "embed the web UI as the core chat surface." They differ only in how much native
  editor glue is added. H2 (fully native) is a separable, higher-cost path best deferred past v1.
- The local-vs-managed/Databricks distinction is **purely a server-URL + auth-mode configuration concern**, not an
  architectural fork — the same extension talks to `/v1` regardless of where the server runs.

## Most Likely Explanation
**Hybrid embed-first (H3)** is the strongest path: ship a thin extension in each IDE that embeds the Omnigent web
UI (VS Code Webview, IntelliJ JCEF) pointed at a **configurable server target** — auto-discovered local server
(`localhost:6767` via pidfile/health) or a user-configured remote/Databricks-hosted URL — reusing Omnigent's
existing auth (`omnigent login` token / Databricks OAuth). Layer a small set of native editor commands on top.
A fully native UI (H2) is viable later by lifting `ap-web/src/lib/*.ts`, but is out of scope for v1.

## Critical Unknown
The **scope/auth boundary for v1**: embed-only vs hybrid-with-native-commands, whether terminals (WebSocket) are
required, and exactly how the extension acquires the server URL + credentials for local vs Databricks-hosted servers.

## Recommended Discriminating Probe
Decide v1 scope along three axes via the interview: (1) embed-only vs hybrid native commands; (2) terminal/WS support
in v1 or not; (3) credential strategy (reuse `~/.omnigent` + CLI vs manual URL/token). These collapse most of the
remaining uncertainty and directly shape the build plan.

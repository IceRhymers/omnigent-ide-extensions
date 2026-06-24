# Work Plan: Omnigent IDE Extensions (VS Code + IntelliJ/PyCharm)

> Consensus draft (ralplan) — **v2, DELIBERATE mode**. Revised after Architect + Critic rejection of v1.
> Source of truth: `.omc/specs/deep-dive-omnigent-ide-extensions.md` (SPEC) and
> `.omc/specs/deep-dive-trace-omnigent-ide-extensions.md` (TRACE). Scope is fixed; this plan turns the
> spec into an execution plan and does NOT relitigate decided facts.

**v1 → v2 changelog (summary):** Flipped VS Code embedding default to bundled `OmnigentApp` +
`OmnigentHostConfig` (Option B) because a Webview cannot navigate to an external https URL and cannot
inject auth into a cross-origin iframe (no CORS on server, no postMessage token bridge in ap-web);
IntelliJ JCEF live-navigate stays default. Resolved native command 3 with evidence (runner-proxied
resources/diff REST works for local AND remote; apply is local-only, remote diffs view-only). Escalated
to DELIBERATE: added pre-mortem (7 scenarios) + expanded test plan (unit/integration/e2e/observability).
Upgraded the discovery/auth contract to a language-neutral conformance fixture (gate, not checklist).
Added long-lived-connection auth lifecycle for SSE + WS, including managed-sandbox origin handling.
Added distribution rigor (version scheme, ap-web SHA pin, CI stance, integrity). Resolved Q3 (baselines),
command-1 send mechanism, command-2 deep-link mechanism, and SPA mount handshake. Added ADR section.

---

## 1. Requirements Summary

Build two IDE extensions that bring Omnigent (`github.com/omnigent-ai/omnigent`) into VS Code and the
JetBrains family (IntelliJ IDEA / PyCharm). Architecture is **hybrid embed-first** (decided):

- **Embed** Omnigent's existing `ap-web` SPA in an in-IDE panel pointed at a **configurable server
  target**. Local-vs-managed/Databricks is a server-URL + auth-mode config concern, NOT an
  architectural fork (SPEC §Architecture; TRACE Convergence Notes). **NOTE (v2):** the *server target*
  is config-uniform, but the *embedding transport* legitimately differs per IDE (Principle 2 and §3).
- **Full parity including interactive terminals** (WebSocket transport). VS Code CSP is
  extension-controlled and MUST allow the server origin + `ws(s)://` (and managed-sandbox WS origins,
  see R2/R9); JCEF is full Chromium so WS works natively (SPEC §Architecture; TRACE Lane 2).
- **Server discovery/auth:** auto-discover local server via `~/.omnigent/local_server.pid`
  (PID + port) + `GET /health` (default `localhost:6767`); reuse bearer token from
  `~/.omnigent/auth_tokens.json` (0600); shell out to `omnigent` / `databricks` CLI for login when
  needed; ALWAYS provide a manual server-URL (+ optional token) override. Handle 401/403 by prompting
  re-login/override (SPEC §Constraints; TRACE Lane 3).
- **v1 native commands:** (1) send selection/file to agent (workspace-relative path context),
  (2) open/switch session panel + connection-status indicator (now also surfaces session **host type**),
  (3) open changed files + view/apply diffs via the IDE's native diff viewer (SPEC §Native commands).
- **Distribution:** buildable artifacts from this OSS repo — VS Code `.vsix` and JetBrains plugin
  `.zip`, manual install. NO marketplace publishing in v1 (SPEC §Constraints).
- **Sequencing:** VS Code FIRST (TS), THEN IntelliJ/PyCharm (Kotlin, JCEF tool window).
- **Non-goals v1:** native (non-embedded) UI, server lifecycle controls, marketplace publishing,
  deploying the omnigent server, published SDK packages (SPEC §Non-Goals).

**API/SSE surface (TRACE Lane 1 + sessions.py evidence, do not re-investigate):**
`POST /v1/sessions` (create), `GET /v1/sessions/{id}` (snapshot),
`POST /v1/sessions/{id}/events` (`message` / `interrupt` / `stop_session` / `compact` /
`slash_command`), `GET /v1/sessions/{id}/stream` (SSE, terminates on `data: [DONE]`),
`GET /api/agents`. **Changed-files / diff (resolved v2):**
`GET /v1/sessions/{id}/resources/files` (list — `sessions.py:15607`),
`GET /v1/sessions/{id}/resources/files/{file_id}/content` (`sessions.py:15751`),
`GET /v1/sessions/{id}/resources/environments/{environment_id}/diff/{relative_path}` (proxies the
runner's diff endpoint, returns before/after content strings — `sessions.py:16015-16039`); SSE
`session.changed_files.invalidated` signals re-fetch. These work for **both** local and managed/remote
(Modal/Daytona/E2B) runners because the server proxies to the runner. Embed surface:
`ap-web/src/embed.tsx` → `OmnigentApp` + `OmnigentHostConfig` (`fetcher`, `resolveWebSocketUrl`,
`cliServerUrlSuffix`, `basename`). **No CORS / CSP / X-Frame / frame-ancestors headers** on the server
(`omnigent/server/app.py:1817-1847`) — which is why same-origin embedding works but cross-origin
authenticated iframe access from a Webview does NOT (see §3 / R2).

---

## 2. Proposed Repo Layout (honest "shared" note)

```
/                              (this OSS repo, monorepo)
├── README.md                  # what this is, build both artifacts, ap-web pin, integrity note
├── docs/
│   ├── install-vscode.md      # manual .vsix install + integrity verification
│   ├── install-intellij.md    # manual plugin .zip install + integrity verification
│   ├── discovery-auth.md      # the normative CONTRACT (see below)
│   ├── embedding-decision.md  # explicit per-IDE embedding-transport divergence (ADR pointer)
│   └── conformance/           # language-neutral JSON test vectors (gate)
│       ├── pidfile.json
│       ├── auth-tokens.json
│       ├── token-precedence.json
│       ├── http-status.json
│       ├── auth-lifecycle.json   # shared 401→refresh→reconnect state-machine scenario
│       └── health.json
├── vscode/                    # TypeScript VS Code extension
│   ├── package.json           # version-stamped; engines.vscode; contributes views/cmds/menus/config
│   ├── esbuild.js
│   ├── tsconfig.json
│   ├── apweb-pin.json         # bundled ap-web build SHA/version (load-bearing)
│   ├── src/
│   │   ├── extension.ts       # activate(): register view + commands + status item
│   │   ├── panel/             # WebviewView provider + CSP + OmnigentApp mount + host bridge
│   │   ├── discovery/         # pidfile + /health probe
│   │   ├── auth/              # token read + CLI login + 401/403 + long-lived auth lifecycle
│   │   ├── config/            # settings + server-target + host-type resolution
│   │   └── commands/          # send-selection, open-session, diffs
│   ├── media/                 # bundled ap-web build + host bootstrap js
│   └── test/                  # unit + conformance-vector runner + integration (stub server)
└── intellij/                  # Kotlin IntelliJ Platform plugin
    ├── build.gradle.kts       # IntelliJ Platform Gradle plugin; version-stamped
    ├── gradle.properties      # sinceBuild / platform version pins
    ├── src/main/
    │   ├── kotlin/.../toolwindow/   # ToolWindowFactory + JBCefBrowser (live-navigate)
    │   ├── kotlin/.../discovery/    # pidfile + /health (parallel impl)
    │   ├── kotlin/.../auth/         # token read + CLI login + 401/403 + auth lifecycle
    │   ├── kotlin/.../config/       # settings + server-target + host-type resolution
    │   └── kotlin/.../actions/      # send-selection, open-session, diffs
    ├── src/main/resources/META-INF/plugin.xml   # version-stamped
    └── src/test/                    # unit + conformance-vector runner + integration
```

**Honest "shared core" call-out:** VS Code is TypeScript/Node; IntelliJ is JVM/Kotlin. There is **no
literal shared code module**. "Shared" = a normative CONTRACT (`docs/discovery-auth.md`) + a
**language-neutral conformance fixture** (`docs/conformance/*.json`) that BOTH suites execute, plus
parallel implementations. The contract pins: (a) pidfile format/parse rules; (b) `/health` semantics +
timeout; (c) token source + precedence (`auth_tokens.json` 0600 vs manual setting vs CLI login);
(d) server-target + host-type resolution order; (e) `Authorization: Bearer <jwt>` transport, 401/403,
and long-lived-connection auth lifecycle behavior. The conformance vectors make the contract
**executable** (R8 is now a gate, see AC9).

---

## 3. Phased Implementation Steps

### Phase A — VS Code extension (reference implementation, ships first)

**A1. Scaffold + build pipeline.** Create `vscode/package.json` (manual scaffold; `esbuild`;
`vsce` for packaging). Pin `engines.vscode` (Q3-resolved below). Declare `contributes.views`
(activity-bar container + `WebviewView`), `contributes.commands`, `contributes.menus` (editor context +
palette), `contributes.configuration` (server URL + token). Stamp `version` per §C scheme. *Files:*
`vscode/package.json`, `esbuild.js`, `tsconfig.json`, `src/extension.ts`. *Cites:* SPEC §Constraints,
§Distribution.

**A2. Config + server-target + host-type resolution.** Settings read (`omnigent.serverUrl`,
`omnigent.token`); resolution order: manual override > auto-discovered local > prompt. Resolve and
expose the **session host type** (local vs managed/remote) so command 3 can gate apply and the status
item can display it. *Files:* `vscode/src/config/*`. *Cites:* SPEC §Constraints; TRACE Lane 3.

**A3. Local-server discovery.** Read `~/.omnigent/local_server.pid` (PID + port), confirm the PID is
the live expected process (guard stale/dead PID — pre-mortem PM6), then `GET /health` (default 6767).
*Files:* `vscode/src/discovery/*`. *Cites:* SPEC Acceptance #2; TRACE Lane 3.

**A4. Auth/token + long-lived auth lifecycle.** Read `~/.omnigent/auth_tokens.json` (respect 0600;
never log token), select the token for the resolved origin, present as `Authorization: Bearer <jwt>`.
Detect Databricks pointer record (no token) → `databricks auth login`; local/omnigent → `omnigent login
<url>` when no token. Detect CLI presence first; on absence fall back to manual override. Centralize
**one-shot HTTP 401/403** AND **long-lived SSE/WS auth lifecycle**: on WS/SSE auth failure, expiry, or
close → tear down the transport, attempt token refresh via the established auth path, then
reconnect/resume; if refresh fails, surface an actionable re-login/override prompt. *Files:*
`vscode/src/auth/*`. *Cites:* SPEC §Constraints (401/403 prompt); TRACE Lane 3; required change #5.

**A5. WebviewView provider + CSP construction.** Build the `WebviewViewProvider`. The webview renders
**extension HTML under a `vscode-webview://` origin**; CSP is fully extension-owned. Set
`connect-src` = the https/http server API origin + `wss:`/`ws:` (and any managed-sandbox WS/stream
origin — R9/Q2). `script-src` with a nonce for the bundled bootstrap; no remote `frame-src` needed
under the chosen mechanism (A6). *Files:* `vscode/src/panel/*`, `vscode/media/*`. *Cites:* SPEC
Acceptance #4; TRACE Lane 2 (Webview CSP is the extension's responsibility).

**A6. Embed via bundled `OmnigentApp` + `OmnigentHostConfig` (Option B — DEFAULT for VS Code).**
*Rationale (decided v2):* a VS Code Webview cannot navigate to an external https URL like a browser tab
— it serves extension HTML and can only embed a remote site through a cross-origin `<iframe>` gated by
CSP `frame-src`. The extension host **cannot inject `Authorization: Bearer`** into that iframe's
fetch/WS calls, the stock served `ap-web` SPA has **no postMessage token bridge**, and the server ships
**no CORS headers** — so cross-origin authenticated access is denied by default. Therefore VS Code
**bundles the `ap-web` build** (pinned SHA, §C) and mounts `OmnigentApp` inside the webview with
`OmnigentHostConfig`: `fetcher` injects the bearer on every request; `resolveWebSocketUrl` resolves WS
auth/origin (incl. managed-sandbox origins). The live-iframe path is demoted: **only viable if a
same-origin reverse proxy is introduced — investigate later** (Q1). *SPA mount handshake:* at panel
init the extension posts the resolved server URL + bearer + initial route to the bootstrap, which
constructs `OmnigentHostConfig` and mounts `OmnigentApp` (token never placed in a navigable URL).
*Files:* `vscode/src/panel/*`, `vscode/media/*` (bundled ap-web + bootstrap). *Cites:* TRACE Lane 2
(`embed.tsx` `OmnigentApp` + `OmnigentHostConfig`, no CORS); required change #1, #8.

**A6a. [BLOCKING GATE] Verify the ap-web embed contract before building command flows (A7–A9).**
The trace establishes that `embed.tsx` *exposes* `OmnigentApp` + `OmnigentHostConfig` (`fetcher`,
`resolveWebSocketUrl`, `cliServerUrlSuffix`, `basename`), but their *semantics* are assumed. Read
`ap-web/src/embed.tsx` and the SSE client (`ap-web/src/lib/sse.ts`, `blockStream.ts`) and CONFIRM, before
A7–A9: (a) the SSE stream connection (`GET /v1/sessions/{id}/stream`) routes through
`OmnigentHostConfig.fetcher` rather than a native browser `EventSource` (which CANNOT set an
`Authorization` header); if it uses `EventSource`, define the token transport (query-string token vs a
`fetch`-based `ReadableStream` reader) and update A6/PM1 accordingly; (b) `resolveWebSocketUrl`'s exact
signature and how it carries auth/origin. This is a cheap, bounded read that de-risks the entire VS Code
path; AC4/AC5 are gated on it. *Files:* (read-only) `ap-web/src/embed.tsx`, `ap-web/src/lib/sse.ts`.
*Cites:* Architect/Critic residual #1; SPEC §Technical Context.

**A7. Native command 1 — send selection/file.** Capture selection or active file, compute the
**workspace-relative path**, and send **directly via `POST /v1/sessions/{id}/events` with a `message`
item** carrying the path context (chosen over the host bridge for determinism and testability; the
mounted `OmnigentApp` reflects it via the live SSE stream). *Files:*
`vscode/src/commands/sendSelection.ts`. *Cites:* SPEC §Native #1; TRACE Lane 1; required change #8.

**A8. Native command 2 — open/switch session + status indicator.** Command + activity-bar entry to
open/focus the panel and start/resume a session. Deep-link by **setting the `OmnigentApp` route /
`basename` via host config** to `/c/:conversationId` (NOT an iframe `src` reload). Status-bar item
reflects connection state AND session **host type** (local vs managed). *Files:*
`vscode/src/commands/openSession.ts`, status wiring in `extension.ts`. *Cites:* SPEC §Native #2;
required change #2, #8.

**A9. Native command 3 — changed files + view/apply diffs (resolved v2).** Subscribe to SSE
`session.changed_files.invalidated`; on signal, list changed files via
`GET /v1/sessions/{id}/resources/files`; for each, fetch before/after strings via
`GET /v1/sessions/{id}/resources/environments/{environment_id}/diff/{relative_path}`. Render in VS
Code's native diff viewer using a **read-only `TextDocumentContentProvider`** (virtual docs for
before/after) + `vscode.diff`. This is **VIEW-ONLY and works for both local AND managed/remote**
sessions (server proxies to the runner). **APPLY** (write after-content to the workspace file) is
**enabled only when session host type = local** (no documented remote write-back endpoint). For
multi-file apply, **snapshot each target file's prior content before writing** (revert restores from the
snapshot — without this the rollback promise is hollow), write atomically per file, and record a
**partial-apply rollback**: on failure mid-batch, report which files were applied and offer revert of the
applied subset from the snapshots. *Files:* `vscode/src/commands/diffs.ts`. *Cites:*
`sessions.py:15607,15751,16015-16039`; required change #2; Architect/Critic residual #4.

**A10. Package + smoke test.** `vsce package` → version-stamped `.vsix`; install; verify panel mounts
`OmnigentApp`, authenticates, and connects. *Cites:* SPEC Acceptance #1.

### Phase B — IntelliJ/PyCharm plugin (port the pattern)

**B1. Scaffold Gradle IntelliJ Platform plugin.** `intellij/build.gradle.kts` (Kotlin); pin platform
version + `sinceBuild` (Q3-resolved). Target IDEA + PyCharm (Community + Professional). Version-stamp
`plugin.xml`. *Files:* `build.gradle.kts`, `gradle.properties`, `META-INF/plugin.xml`. *Cites:* SPEC
§Constraints, §Distribution.

**B2. ToolWindow + JCEF browser (live-navigate — DEFAULT for IntelliJ).** `ToolWindowFactory` hosting
`JBCefBrowser`. JCEF is full in-process Chromium with same-origin `loadURL`, so **live-navigate to the
resolved server URL** is valid and is the default here — WS terminals work natively, no CSP work. Pass
the bearer via JCEF request interception / cookie as the server's auth mode requires. Guard
`JBCefApp.isSupported()` (R5). *Files:* `intellij/.../toolwindow/*`. *Cites:* SPEC §Architecture;
required change #1.

**B3. Discovery / auth / config (parallel impl of the contract).** Re-implement A2–A4 in Kotlin against
`docs/discovery-auth.md`, including the long-lived auth lifecycle. *Files:*
`intellij/.../{discovery,auth,config}/*`. *Cites:* SPEC §Constraints; §2 contract; required change #5.

**B4. Same three native actions (Kotlin `AnAction`s).** (1) send selection/file via
`POST /v1/sessions/{id}/events`; (2) open/switch session + host-type status; navigate JCEF to
`/c/:conversationId`; (3) changed files + diffs via the resources/diff REST API rendered with
`DiffManager` + in-memory `DiffContent` (view-only remote, apply local-only, partial-apply rollback).
*Files:* `intellij/.../actions/*`, `plugin.xml`. *Cites:* SPEC §Native #1-3; required change #2.

**B5. Build + smoke test.** `./gradlew buildPlugin` → version-stamped `.zip`; install in IDEA + PyCharm;
verify parity. *Cites:* SPEC Acceptance #7.

### Phase C — Build/packaging + distribution rigor + docs

**C1. Version scheme.** Single source-of-truth version stamped into `vscode/package.json` and
`intellij/.../plugin.xml`, AND reflected in the artifact filename
(`omnigent-vscode-<ver>.vsix`, `omnigent-intellij-<ver>.zip`).
**C2. ap-web pin (load-bearing).** Record the bundled `ap-web` build SHA/version in
`vscode/apweb-pin.json` and in README; the bundled UI version IS the VS Code artifact's behavior.
**C3. CI stance.** State explicitly whether CI builds the artifacts or builds are local-only (default
recommendation: CI builds both artifacts on tag, uploads as release assets; local build documented as
fallback).
**C4. Integrity for unsigned artifacts.** Publish SHA-256 checksums (optionally a signature) for each
artifact in the release; `install-*.md` instruct verifying the checksum before manual install.
**C5. Docs.** `install-vscode.md`, `install-intellij.md`, finalize `discovery-auth.md` +
`docs/conformance/*`, `embedding-decision.md`, top-level `README.md`. *Cites:* SPEC Acceptance #8;
required change #6.

---

## 4. Acceptance Criteria (sharpened + testable)

- **AC1 — VS Code packaging.** `vsce package` produces a version-stamped `.vsix`; installing it adds an
  Omnigent view that mounts the bundled `OmnigentApp` and renders the SPA against a reachable server.
- **AC2 — Local auto-discovery.** With a local server running, the extension parses
  `~/.omnigent/local_server.pid`, confirms the PID is the live expected process (rejects stale/dead
  PIDs), gets HTTP 200 from `GET /health`, and connects with zero manual config.
- **AC3 — Manual override + auth-failure UX.** Setting `omnigent.serverUrl` (+ optional token) connects
  to a remote/Databricks server; a forced 401/403 surfaces an actionable re-login/override prompt.
- **AC4 — Terminals stream + WS lifecycle.** An interactive terminal streams bidirectionally; in VS
  Code the host transport's `resolveWebSocketUrl` + CSP `connect-src` permit the WS origin (incl.
  managed-sandbox origin); on token expiry the WS tears down, refreshes, and reconnects/resumes (or
  prompts re-login); on panel close / session switch the WS tears down cleanly with no leak.
- **AC5 — Core UI flows.** Chat, tool calls, reasoning, and elicitation/approval render correctly via
  the embedded `OmnigentApp` (each event class confirmed).
- **AC6 — Native commands incl. diffs (both host types).** Send selection/file injects a `message`
  with the correct workspace-relative path; open/switch session focuses the panel, navigates to
  `/c/:conversationId`, and the status item shows connection state + host type. For a **local** session:
  changed files open in the native diff viewer and **apply** writes after-content to the workspace
  (partial-apply reports + revert path on mid-batch failure). For a **managed/remote** session: changed
  files render **view-only** (apply disabled), proving the resources/diff proxy works remotely.
- **AC7 — IntelliJ parity.** `./gradlew buildPlugin` produces a version-stamped `.zip` installable in
  IDEA + PyCharm; JCEF tool window live-navigates to the server; terminals stream; the same three
  native actions (incl. remote view-only / local apply diffs) work via IntelliJ native APIs.
- **AC8 — Distribution rigor.** Both artifacts are version-stamped in manifest AND filename; the bundled
  `ap-web` SHA/version is recorded in README + `apweb-pin.json`; release publishes SHA-256 checksums;
  install docs cover integrity verification; the CI-vs-local build stance is documented.
- **AC9 — Conformance gate.** Both the TS (vscode) and Kotlin (intellij) test suites run the shared
  `docs/conformance/*.json` vectors and pass identically (pidfile parse incl. stale/dead/malformed;
  token resolution incl. Databricks pointer record; token precedence; 401 vs 403; `/health` variants;
  and the `auth-lifecycle.json` 401→refresh→reconnect/resume scenario so the highest-risk cross-language
  behavior — not just parsing — is drift-gated).

---

## 5. Risks and Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | VS Code CSP blocks WebSockets (terminals fail) | Med | High | `connect-src` explicitly includes `ws:`/`wss:` + the WS origin(s); smoke-test terminal I/O at A6 before native commands; AC4 is a Phase-A gate. |
| R2 | **Cross-origin authenticated iframe is impossible in a Webview** (no CORS, no token injection, no postMessage bridge) | High | High | **Resolved by flipping to Option B (A6):** bundle ap-web + `OmnigentHostConfig` so the extension owns transport/auth. Live-iframe demoted to "needs same-origin reverse proxy — investigate later" (Q1). |
| R3 | Insecure `~/.omnigent` token handling (leak into logs / URLs / webview) | Med | High | Respect 0600; never log token (redact in diagnostics); inject only via host `fetcher`/WS transport, never in a navigable URL. |
| R4 | CLI unavailable for `databricks`/`omnigent` login | Med | Med | Detect presence before shelling out; fall back to manual server-URL + token override; never hard-require a CLI. |
| R5 | JCEF unavailable in some IntelliJ runtimes (non-JCEF JBR) | Med | High | `JBCefApp.isSupported()` guard at tool-window init; actionable guidance to switch to a JCEF-capable JBR; pin a JCEF-capable `sinceBuild`. |
| R6 | Version/baseline drift | Med | Med | Q3 resolved below; document support matrix; version-stamp artifacts (§C). |
| R7 | Auth-mode mismatch (server expects cookie/OIDC, extension sends bearer) | Low | Med | v1 targets CLI-style bearer (per spec); 401/403 + lifecycle path (R3/A4) handles failure; document cookie/OIDC as server's concern. |
| R8 | Drift between TS and Kotlin discovery/auth impls | Med | Med | **Upgraded to a gate:** shared conformance vectors (`docs/conformance/*`) run in both suites; AC9 blocks release on divergence. |
| R9 | **Managed-sandbox WS/stream origin differs from the API origin** and is missing from `connect-src` | Med | High | Confirm whether terminal WS targets the API origin or a per-sandbox origin (Q2); if dynamic, `resolveWebSocketUrl` returns the per-sandbox origin and CSP `connect-src` is widened/set per session to cover it. |
| R10 | **Bundled ap-web build drifts from the live server API** and breaks SSE/event parsing | Med | High | Pin ap-web SHA (§C2); record in README; document the compatibility window; treat a server API bump as requiring a re-pin + re-test of AC5. |
| R11 | Long-lived connection silently dies on token expiry (no reconnect) | Med | High | Auth lifecycle (A4/AC4): detect WS/SSE auth-close, refresh, reconnect/resume, else prompt. |

---

## 6. Verification Steps (manual, per AC)

- **AC1:** `vsce package`; confirm version-stamped `.vsix`; `code --install-extension`; open view;
  observe `OmnigentApp` mounts and renders against a running server.
- **AC2:** Start local server; clear manual settings; reload; confirm zero-prompt connect and status =
  connected/local. Then corrupt the pidfile (dead PID) and confirm discovery rejects it gracefully.
- **AC3:** Point at a remote/Databricks server; confirm connect; expire/revoke token; trigger a request;
  confirm the re-login/override prompt.
- **AC4:** Open a terminal; type a command; confirm live bidirectional output; inspect dev tools for no
  CSP violations on the WS origin. Expire the token mid-session; confirm teardown → refresh → reconnect
  (or prompt). Close the panel / switch session; confirm the WS tears down (no orphaned socket).
- **AC5:** Drive chat text, a tool call, a reasoning block, and an elicitation/approval; confirm each
  renders in `OmnigentApp`.
- **AC6:** With a file open, run send-selection; confirm the message + correct workspace-relative path
  arrives. Run open/switch-session; confirm focus, `/c/:id` route, and status (state + host type).
  **Local session:** have the agent change a file; run changed-files; confirm native diff opens and
  apply writes the file; force a mid-batch failure and confirm partial-apply report + revert.
  **Remote/managed session:** confirm changed-files render view-only and apply is disabled.
- **AC7:** `./gradlew buildPlugin`; install `.zip` in IDEA + PyCharm; repeat AC4-AC6 against JCEF +
  Kotlin actions.
- **AC8:** Inspect artifact filenames + manifests for the version; confirm `apweb-pin.json` + README
  record the ap-web SHA; verify published SHA-256 checksums against the artifacts; follow install docs'
  integrity step; confirm README states the CI-vs-local build stance.
- **AC9:** Run `npm test` (vscode) and `./gradlew test` (intellij); confirm both execute the shared
  `docs/conformance/*.json` vectors and pass identically.

---

## 7. Pre-Mortem (DELIBERATE mode — failure scenarios)

- **PM1 — Panel renders, every fetch 401s.** `OmnigentApp` mounts but `OmnigentHostConfig.fetcher`
  isn't wired (or the bearer never reaches it via the mount handshake), so all `/v1` calls 401.
  *Guard:* integration test asserts `fetcher` attaches `Authorization` against a stub server before any
  e2e; the mount handshake is a tested unit (A6).
- **PM2 — WS upgrade blocked by `connect-src` despite frame-src allowing the origin.** Terminal/SSE WS
  fails because CSP allows the document/frame but not the `wss:` connection.
  *Guard:* CSP-construction unit test asserts `connect-src` includes `wss:` + the resolved WS origin;
  AC4 dev-tools check.
- **PM3 — Token expires mid-terminal, no reconnect, terminal silently dies.** Long-lived WS closes on
  expiry; nothing refreshes/reconnects; user sees a frozen terminal.
  *Guard:* auth lifecycle (A4/R11/AC4) detects close → refresh → reconnect/resume or prompt.
- **PM4 — Managed-sandbox WS/stream origin differs from the API origin and isn't in `connect-src`.**
  Chat works (API origin) but terminals fail (per-sandbox origin).
  *Guard:* R9/Q2 — confirm origin model; `resolveWebSocketUrl` returns the sandbox origin and CSP is
  widened/dynamic; AC4 exercised against a managed session.
- **PM5 — Bundled ap-web drifts from the live server API and breaks event parsing.** A server SSE schema
  change isn't reflected in the pinned UI build; events mis-parse.
  *Guard:* R10 — pinned SHA + recorded compat window; re-pin + re-run AC5 on server API bumps.
- **PM6 — Stale pidfile misroutes discovery.** PID is alive but belongs to a different process, or a
  dead PID lingers; discovery connects to nothing or the wrong port.
  *Guard:* A3 verifies the PID is the expected live process before probing; conformance vector
  `pidfile.json` covers stale/dead/malformed cases (AC9).
- **PM7 — IntelliJ JBR lacks JCEF.** Tool window can't create a browser.
  *Guard:* R5 — `JBCefApp.isSupported()` guard + actionable guidance + JCEF-capable `sinceBuild`.

## 8. Expanded Test Plan (DELIBERATE mode)

- **Unit (no IDE host needed):** discovery (pidfile parse incl. stale/dead/malformed, `/health`
  timeout), auth (token selection, Databricks pointer-record detection, precedence, 401 vs 403
  mapping), config (server-target + host-type resolution order), CSP string construction. **All unit
  logic must execute the `docs/conformance/*.json` vectors** in both TS and Kotlin.
- **Integration (stub server):** `OmnigentHostConfig.fetcher` attaches `Authorization` and hits the
  stub; `resolveWebSocketUrl` resolution incl. a divergent managed-sandbox origin; SSE parsing incl.
  `session.changed_files.invalidated`; resources/diff response parsing into before/after strings;
  auth-lifecycle state machine (expire → refresh → reconnect) against a stub that 401s then accepts.
- **E2E (real IDE host):** AC4 (terminal stream + reconnect + teardown), AC5 (event-class rendering),
  AC6 (send-selection, deep-link, local apply + remote view-only diffs) in both VS Code and IDEA/PyCharm.
- **Observability:** redacted diagnostic logging (never logs the token) that reveals: which embedding
  mechanism is live (VS Code bundled OmnigentApp vs IntelliJ JCEF live-navigate), the resolved server
  target + host type, the resolved WS origin, and the failure reason on any connection/auth error
  (status code, refresh outcome). A "copy diagnostics" command for bug reports.

## 9. Open Questions (remaining)

- **Q1 (live-iframe revisit).** A live-navigate/iframe VS Code embed is only viable behind a same-origin
  reverse proxy (to satisfy CORS + auth). Out of scope for v1; revisit only if bundling ap-web proves
  unsustainable.
- **Q2 (managed-sandbox WS origin).** Does the terminal/stream WS target the API server origin or a
  per-sandbox origin (Modal/Daytona/E2B)? If dynamic per session, `resolveWebSocketUrl` + CSP
  `connect-src` must be set per session. Confirm before AC4 on managed sessions.
- **Q5 (CLI invocation surface).** Exact subcommands/flags for `omnigent login <url>` and
  `databricks auth login`, and exact shape of the Databricks pointer record in `auth_tokens.json`
  (informs the `auth-tokens.json` conformance vector).

**Resolved in v2:** Q3 (baselines, below); embedding mechanism (A6, Option B for VS Code, JCEF for
IntelliJ); command-1 send mechanism (`POST /events`); command-2 deep-link (host route, not iframe src);
command-3 source-of-truth (resources/diff REST, remote view-only / local apply).

### Q3 — Resolved baselines (revisable)
- **VS Code:** `engines.vscode` minimum **`^1.90.0`** (June 2024 baseline; covers current Webview +
  `TextDocumentContentProvider` APIs). Revisable downward if a supported audience needs older.
- **IntelliJ Platform:** `sinceBuild` **`241`** (2024.1, ships a JCEF-capable JBR) with `untilBuild`
  **open-ended** (omit upper bound) to track current IDEA + PyCharm (Community + Professional).
  Open `untilBuild` is a deliberate **reach-over-safety** choice; record the highest IDEA/PyCharm build
  actually tested in the support matrix so a future platform break (e.g. a JCEF/API change) is
  attributable. Revisable as the platform moves.

---

## RALPLAN-DR SUMMARY (DELIBERATE mode)

### Principles
1. **Reuse over rebuild** — embed the maintained `ap-web` SPA; never re-implement chat/tool/terminal UI.
2. **Config-uniform server target, IDE-appropriate embedding transport.** The *server target* (local vs
   remote/Databricks) is a uniform config concern with one `/v1` surface. The *embedding transport*
   legitimately differs by IDE webview capability: VS Code (`vscode-webview://` origin, no external
   navigation, no cross-origin auth injection) → **bundle ap-web + `OmnigentHostConfig`**; IntelliJ
   (JCEF full Chromium, same-origin `loadURL`) → **live-navigate**. This is NOT a server fork.
3. **Thin, native-where-it-counts** — only the editor-native commands that beat a browser tab.
4. **Contract-first parallelism, gated by conformance vectors** — `docs/discovery-auth.md` +
   `docs/conformance/*.json` are the single source of truth; TS and Kotlin must pass the same vectors.
5. **Graceful degradation + lifecycle resilience** — never hard-require CLI/JCEF; recover long-lived
   SSE/WS on token expiry; always offer the manual override.

### Decision Drivers (top 3)
1. **Authenticated, full-parity embedding incl. WS terminals** — the binding constraint that forces the
   per-IDE transport split (no CORS / no cross-origin auth in a Webview iframe).
2. **Zero UI re-implementation / fastest path to parity** — embed the SPA over a native client.
3. **Buildable OSS artifacts, no marketplace, manual install** — favors simple independent toolchains +
   explicit version/SHA pinning + integrity over heavyweight machinery.

### Viable Options (>=2)

**Option B — Bundle ap-web + mount `OmnigentApp` via `OmnigentHostConfig`** *(CHOSEN for VS Code)*
- Pros: extension fully owns transport — `fetcher` injects the bearer, `resolveWebSocketUrl` resolves WS
  auth/origin; deterministic auth; the *intended* first-class embed surface; CSP fully controlled.
- Cons: couples the artifact to a pinned ap-web build (drift risk R10; larger artifact; re-pin on UI
  changes); more upfront wiring; SPA version IS the artifact's behavior (mitigated by §C2 pin).

**Option A — Live-navigate / iframe the served web UI** *(CHOSEN for IntelliJ; INVALIDATED for VS Code)*
- Pros (IntelliJ): JCEF is same-origin full Chromium → `loadURL` to the server works, WS native, thinnest
  possible; always reflects the live server UI; no bundled-build drift.
- Cons / **invalidation for VS Code:** a Webview cannot navigate to an external https URL; it can only
  embed via a cross-origin `<iframe>`, into which the host CANNOT inject `Authorization` headers; ap-web
  has no postMessage token bridge; the server ships no CORS headers → cross-origin authenticated access
  is denied. Viable in VS Code only behind a same-origin reverse proxy (Q1, deferred).

### Resolution
**Per-IDE divergence is the decision, and it is intentional and documented.** VS Code uses **Option B**
(bundled `OmnigentApp` + `OmnigentHostConfig`) because its webview model makes a cross-origin
authenticated iframe impossible without a reverse proxy; the extension therefore owns transport and
injects the bearer via `fetcher` and resolves WS via `resolveWebSocketUrl`. IntelliJ/PyCharm uses
**Option A** (JCEF `loadURL` live-navigate) because JCEF is same-origin full Chromium where the served
SPA + native WS just work. The *server target* remains config-uniform across both. Native command 3 is
resolved by evidence: changed-files/diffs use the runner-proxied resources/diff REST API
(`sessions.py:15607/15751/16015-16039`), which works for **both** local and managed/remote sessions
(view-only); **apply** is enabled only for local sessions (no documented remote write-back), with
partial-apply rollback. The discovery/auth contract is gated by shared conformance vectors (AC9). Risk
posture is DELIBERATE: pre-mortem (§7) + expanded test plan (§8) + auth-lifecycle resilience are in scope
for v1.

> Mode: **DELIBERATE.** Pre-mortem (§7) and expanded test plan (§8) included.

---

## ADR — Omnigent IDE Extensions Embedding & Diff Strategy

**Status:** Accepted (consensus reached — Architect SOUND-WITH-CHANGES + Critic APPROVE-WITH-NITS; the
four fold-in nits are incorporated: A6a embed-contract gate, A9 pre-write snapshot for truthful rollback,
`auth-lifecycle.json` shared conformance vector, and the open-`untilBuild` reach-over-safety note).

**Decision.** Build embed-first hybrid IDE extensions. **VS Code** mounts the bundled `ap-web`
`OmnigentApp` inside a `WebviewView` and supplies an `OmnigentHostConfig` whose `fetcher` injects the
`Authorization: Bearer` token and whose `resolveWebSocketUrl` resolves WS auth/origin; the bundled
ap-web build SHA is pinned and recorded. **IntelliJ/PyCharm** live-navigates a JCEF `JBCefBrowser` to
the resolved server URL (same-origin full Chromium). The **server target** (local auto-discovered vs
remote/Databricks) is config-uniform with one `/v1` surface across both IDEs. **Changed files / diffs**
use the runner-proxied resources/diff REST endpoints (works for local AND managed/remote sessions,
view-only); **apply** is enabled only for local-host sessions, with partial-apply rollback. Risk posture
is **DELIBERATE** (pre-mortem + expanded test plan + long-lived-connection auth lifecycle in v1 scope).

**Drivers.** (1) Authenticated full-parity embedding including WebSocket terminals; (2) zero UI
re-implementation / fastest parity; (3) buildable OSS artifacts (no marketplace) with integrity +
version/SHA pinning.

**Alternatives considered.**
- *Live-iframe the served UI in VS Code* — rejected: Webview can't navigate externally, can't inject auth
  into a cross-origin iframe, no ap-web postMessage bridge, no server CORS → denied without a same-origin
  reverse proxy (deferred, Q1).
- *Fully native (non-embedded) UI in both IDEs* — deferred (SPEC non-goal): high effort, would require a
  lifted TS SSE client and a from-scratch JVM client; re-implements an already-maintained surface.
- *Scope diffs/apply to local sessions only* — rejected for diffs (evidence shows remote view-only works
  via the proxy); retained only for *apply* (no remote write-back endpoint).

**Why chosen.** Option B is the only path that delivers authenticated, full-parity embedding in VS
Code's webview model; JCEF makes the simpler live-navigate path correct for IntelliJ. The per-IDE split
is a property of the webview platforms, not an architectural fork — the server contract is uniform. The
resources/diff API is the documented, runner-proxied source of truth for changed files across host types.

**Consequences.** (+) Deterministic auth and full WS parity in VS Code; thinnest possible IntelliJ
embed; diffs work remotely; conformance vectors prevent cross-language drift. (−) VS Code artifact is
coupled to a pinned ap-web build (drift risk R10, mitigated by the recorded SHA + re-pin discipline);
two embedding code paths to maintain; apply is asymmetric (local-only) by necessity; long-lived-connection
lifecycle adds complexity.

**Follow-ups.** Q1 (same-origin reverse proxy to enable a live VS Code embed later); Q2 (managed-sandbox
WS origin model — gate AC4 on managed sessions); Q5 (exact CLI subcommands + Databricks pointer-record
shape for the conformance vector); revisit Q3 baselines as platforms move; evaluate a remote write-back
path to enable remote apply in a future version.

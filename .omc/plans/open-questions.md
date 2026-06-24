# Open Questions

## Omnigent IDE Extensions (ralplan) - 2026-06-23 (v2, DELIBERATE)

### Resolved in v2
- [x] Q1 (original): VS Code embedding mechanism — RESOLVED. A Webview cannot navigate to an external https URL and cannot inject auth into a cross-origin iframe (no server CORS, no ap-web postMessage bridge). VS Code default = bundle ap-web + mount `OmnigentApp` via `OmnigentHostConfig` (Option B). IntelliJ default = JCEF `loadURL` live-navigate. Live-iframe in VS Code re-filed as Q1' below (deferred).
- [x] Q2 (original): token-to-iframe injection — RESOLVED by adopting Option B; the bearer is injected via `OmnigentHostConfig.fetcher`, never a navigable URL.
- [x] Q3: Version pins — RESOLVED (revisable). VS Code `engines.vscode` `^1.90.0`; IntelliJ `sinceBuild` `241` (2024.1, JCEF-capable JBR), `untilBuild` open-ended.
- [x] Q4: Monorepo tooling — RESOLVED. Plain folders + independent per-IDE toolchains for v1 (TS vs JVM split); no workspace manager.
- [x] Native command 1 send mechanism — RESOLVED. `POST /v1/sessions/{id}/events` with a `message` item carrying workspace-relative path context.
- [x] Native command 2 deep-link — RESOLVED. Set `OmnigentApp` route/`basename` via host config to `/c/:conversationId` (not an iframe src reload).
- [x] Native command 3 source-of-truth — RESOLVED by evidence. Runner-proxied resources/diff REST (`sessions.py:15607/15751/16015-16039`) works for local AND remote (view-only); apply enabled only for local-host sessions.

### Remaining (v2)
- [ ] Q1' (deferred): A live-navigate/iframe VS Code embed is only viable behind a same-origin reverse proxy (CORS + auth). Out of scope for v1; revisit only if bundling ap-web proves unsustainable. — Drives whether VS Code can ever drop the bundled build.
- [ ] Q2' (managed-sandbox WS origin): Does the terminal/stream WebSocket target the API server origin or a per-sandbox origin (Modal/Daytona/E2B)? If dynamic per session, `resolveWebSocketUrl` + CSP `connect-src` must be set per session. — Gates AC4 on managed sessions.
- [ ] Q5: Exact CLI subcommands/flags for `omnigent login <url>` and `databricks auth login`, and the exact shape of the Databricks pointer record in `auth_tokens.json`. — Needed for the auth shell-out and the `auth-tokens.json` conformance vector.

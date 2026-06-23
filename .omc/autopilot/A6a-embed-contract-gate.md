# A6a Blocking Gate — ap-web Embed Contract Verification (RESOLVED ✅)

Verified against `github.com/omnigent-ai/omnigent` HEAD via zoekt before building command flows (A7–A9).

## Question
Does `OmnigentHostConfig.fetcher` cover the SSE stream (`GET /v1/sessions/{id}/stream`), or does ap-web
use a native browser `EventSource` (which cannot set an `Authorization` header)? And what is
`resolveWebSocketUrl`'s exact contract?

## Findings (with citations)

### HTTP transport — single choke point through `fetcher`
- `ap-web/src/lib/host.ts:136` — `hostFetch(path, init)` delegates to `_config.fetcher` when set, else
  native `fetch`. **All HTTP goes through here.**
- `ap-web/src/lib/host.ts:117` — `setOmnigentHostConfig` guards against clobbering an installed `fetcher`
  with empty props (relevant to the mount handshake).
- `ap-web/src/lib/sessionsApi.ts:16` — `import { authenticatedFetch } from "./identity"`.
- `ap-web/src/lib/identity.ts:144` — `authenticatedFetch` calls `hostFetch(...)` → so it routes through
  `_config.fetcher`.
- `ap-web/src/lib/sessionsApi.ts:864` — the **stream** is opened with
  `authenticatedFetch('/v1/sessions/{id}/stream', ...)` and returns a `Response` whose `res.body` is piped
  through `parseSseStream`.
- `ap-web/src/lib/sse.ts:78,100` — `parseSseStream` consumes "the body of `fetch('/v1/sessions/{id}/stream')`"
  via `getReader()` (a **fetch-based `ReadableStream` reader, NOT `EventSource`**; chosen for iOS Safari).
- Other `/v1` calls also route through `hostFetch`: `capabilities.ts:90` (`/v1/info`), `identity.ts:64`
  (`/v1/me`), `SessionImage.tsx:51`.

**Conclusion:** Injecting `Authorization: Bearer <jwt>` (and rebasing to the server origin) inside the
host `fetcher` covers EVERY REST call **including the SSE chat stream**. The `EventSource` header
limitation does NOT apply. PM1's guard (integration-test that `fetcher` attaches `Authorization`) is the
right gate and is sufficient.

### WebSocket transport — through `resolveWebSocketUrl`
- `ap-web/src/lib/host.ts:143` — `resolveWebSocketUrl(path)` delegates to `_config.resolveWebSocketUrl`,
  else builds `ws(s)://window.location.host{path}`.
- `ap-web/src/components/blocks/TerminalView.tsx:443` — terminal attach WS uses `resolveWebSocketUrl(...)`.
- `ap-web/src/lib/sessionUpdatesSocket.ts:66` — session-updates WS uses
  `resolveWebSocketUrl('/v1/sessions/updates')`.

**Signature:** `resolveWebSocketUrl(path: string) => string` — returns a fully-qualified `ws(s)://` URL.
The host controls the origin (covers managed-sandbox origins, R9/Q2).

**Caveat (carry into A4/Q2):** browsers cannot set request headers on a `WebSocket` handshake, so for a
remote/authenticated server the bearer cannot ride an `Authorization` header on the WS. Options: (a) local
single-user server requires no WS auth (primary v1 path — unblocked); (b) remote servers need the token in
a query-string param or a subprotocol — confirm omnigent's WS auth acceptance (extends Q2). Does NOT block
the local-session path.

## Embed mount mechanics (informs A6 handshake)
- `ap-web/src/embed.tsx` — `OmnigentApp({ basename, routing, isDarkMode, ...hostConfig })` mounts the full
  app with NO `<Router>` (host supplies router) and its OWN bundled `QueryClient`. It calls
  `setOmnigentHostConfig(hostConfig)` once per mount; the host can ALSO call the exported
  `setOmnigentHostConfig` EAGERLY before first render (recommended for the webview bootstrap).
- Routing: `App` matches absolute paths prefixed with `basename`; `navigate()`/`<Link>` are rebased via
  `basenamedRouting`. So native command 2 deep-links by driving the host router to `${basename}/c/:id`
  (or `/c/:id` with no basename in the webview) — NOT an iframe reload. ✅
- IMPORTANT externals: `embed.tsx` leaves React/ReactDOM/react-router(-dom) as BARE externals expecting the
  HOST to provide React 18 + react-router 6.4.1. The VS Code webview bootstrap must therefore supply a
  React 18 + react-router-dom 6.4.x runtime and a Router around `OmnigentApp`. Pin these in `apweb-pin.json`
  alongside the ap-web build SHA. (New build-integration note for A6/C2.)

## Verdict
Option B (bundle ap-web + `OmnigentHostConfig`) is confirmed viable. `fetcher` covers all HTTP incl. SSE;
`resolveWebSocketUrl` covers WS. Proceed with A7–A9. Two carry-forward notes: WS bearer-in-query for remote
servers (Q2), and the host must supply React 18 + react-router-dom 6.4.x as externals for the bundled embed.

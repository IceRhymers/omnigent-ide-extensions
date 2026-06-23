# Discovery & Auth Contract (Normative)

This is the **single source of truth** for how both IDE extensions (VS Code / TypeScript and the
future IntelliJ / Kotlin port) discover the Omnigent server, resolve a server target + host type,
read credentials, and manage authentication on both one-shot HTTP and long-lived (SSE/WS)
connections.

The behavior described here is made **executable** by the language-neutral JSON vectors in
[`docs/conformance/`](./conformance/). Both language implementations MUST run those vectors and
produce identical outputs (Acceptance Criterion AC9). The vectors are the contract; this document is
the prose that explains them. Keep vectors free of language specifics.

> Scope note: this document covers the **foundation** (Phase A steps A1–A4 of the plan) — discovery,
> config/target resolution, auth/token, and the long-lived auth lifecycle *interface*. It does not
> cover the webview panel, command flows, or bundling (A5–A10).

---

## 1. Local-server discovery: pidfile format & parse rules

The local Omnigent daemon writes `~/.omnigent/local_server.pid`. Default port is **6767**.

**Format:** two lines.

```
<pid>
<port>
```

- Line 1 is the integer PID of the running daemon.
- Line 2 is the integer TCP port it is listening on.
- A trailing newline is allowed; surrounding whitespace on each line is trimmed.

**Parse rules** (pure; see [`conformance/pidfile.json`](./conformance/pidfile.json)):

| Condition | Result `status` |
|---|---|
| Two parseable lines, PID is a positive integer, port is in `1..65535`, **and the PID is alive** | `ok` (with `pid`, `port`, `baseUrl`) |
| Same as above but the **PID is not alive** | `dead` (with `pid`, `port`) |
| Fewer than two lines (e.g. port-only, empty) | `malformed` |
| PID not an integer / not positive | `malformed` |
| Port not an integer / out of range | `malformed` |

When `status === 'ok'`, the derived local probe target is `baseUrl = http://127.0.0.1:<port>`.

**Liveness / staleness (PM6).** The parse logic is pure and takes `pidAlive` as an input observation
so it can be tested without spawning processes. The runtime supplies that observation via an OS
liveness probe — at minimum `process.kill(pid, 0)` (signal 0) on POSIX, which throws `ESRCH` if the
PID does not exist and succeeds (or throws `EPERM`) if it does. **Deeper identity checks** (confirming
the live PID is actually the Omnigent daemon and not a recycled PID) are **best-effort** and not
required by this contract: the authoritative confirmation that the right server is reachable is the
`/health` probe (§2). A `dead` result MUST cause discovery to fall through (do not probe), not crash.

---

## 2. `/health` probe semantics & timeout

After discovery yields a candidate `baseUrl` (from the pidfile or a manual override), confirm the
server with `GET {base}/health`.

- **Healthy** iff HTTP **200** AND the JSON body is `{ "status": "ok" }`.
- **Timeout:** the probe uses a short deadline. Default **2000 ms** (`timeoutMs` in
  [`conformance/health.json`](./conformance/health.json)). Exceeding it yields `timeout`.
- A response that is non-200, or 200 without `status: "ok"`, yields `unhealthy`.
- A connection refused / network error yields `unreachable`.

Only an `ok` outcome confirms a usable target. Any other outcome MUST cause the caller to fall
through to the next target in the resolution order (§4) or prompt.

---

## 3. Token source & precedence (incl. Databricks pointer)

Tokens live in `~/.omnigent/auth_tokens.json` (mode **0600**). The file is a JSON object keyed by
**origin** (`scheme://host[:port]`). Two record shapes exist:

1. **Normal bearer record:** `{ "token": "<jwt>", "user_id": "...", "expires_at": <epoch-seconds> }`.
2. **Databricks pointer record:** `{ "auth_type": "databricks", "workspace_host": "..." }` — carries
   **no token**. It signals that a fresh OAuth token must be minted out-of-band via
   `databricks auth login` before the server can be reached.

**Origin resolution** (see [`conformance/auth-tokens.json`](./conformance/auth-tokens.json)) matches
the requested origin **exactly** and returns one of: `bearer`, `databricks-pointer`, `none`.

**Precedence** (see [`conformance/token-precedence.json`](./conformance/token-precedence.json)):

1. **Manual setting** (`omnigent.token`) — wins whenever non-empty (`source: manual`).
2. **Matching bearer record** from `auth_tokens.json` (`source: file`).
3. **Matching Databricks pointer record** → `source: databricks-pointer` (caller runs
   `databricks auth login`).
4. Otherwise `source: none` — caller triggers CLI login (`omnigent login <url>`) or the manual prompt.

**Secret hygiene (R3).** The token is a secret. It MUST NEVER be logged, placed in a navigable URL,
or written to diagnostics. Implementations provide and use a `redact()` helper for any value that may
contain a token; redacted diagnostics show only that a token is present/absent and its source, never
its value.

---

## 4. Server-target & host-type resolution order

A **ServerTarget** carries the resolved `baseUrl`, the `origin`, and a `hostType` of
`local | remote | unknown`.

**Resolution order** (A2):

1. **Manual override** — if `omnigent.serverUrl` is set and non-empty, use it. `hostType` is `remote`
   unless the host is a loopback address (`localhost` / `127.0.0.1` / `::1`), in which case `local`.
2. **Auto-discovered local** — if no manual override, parse the pidfile (§1); on `ok`, the candidate
   is `http://127.0.0.1:<port>` with `hostType: local`. Confirm via `/health` (§2).
3. **Prompt** — if neither yields a healthy target, the caller prompts the user for a manual URL.

`hostType` gates downstream behavior the foundation does not implement yet (e.g. diff **apply** is
local-only in A9). `unknown` is used when a target exists but its locality cannot be determined.

---

## 5. Bearer transport, 401 vs 403, and the long-lived auth lifecycle

### 5.1 Transport

Authenticated requests present `Authorization: Bearer <jwt>`. The `authHeader()` helper returns
`{ "Authorization": "Bearer <jwt>" }` when a token resolves, or no header otherwise. Cookie / OIDC /
header auth modes are the server's concern and out of scope for v1 (CLI-style bearer only).

> WS caveat (from the A6a embed-contract gate): browsers cannot set request headers on a WebSocket
> handshake. The local single-user server requires no WS auth (primary v1 path). Remote servers need
> the token via query-string param or subprotocol — tracked as open question Q2; does not block local.

### 5.2 One-shot HTTP status mapping

See [`conformance/http-status.json`](./conformance/http-status.json):

- **2xx** → `ok`.
- **401** → `reauth` — token missing/expired/invalid; attempt refresh / re-login then retry, or
  prompt. (Distinct from forbidden — do not show a permissions error.)
- **403** → `forbidden` — authenticated but not permitted; surface a forbidden message, do **not**
  enter a re-login loop.
- other non-2xx → `error`.

### 5.3 Long-lived (SSE/WS) auth lifecycle interface

Long-lived connections (the SSE chat stream via `GET /v1/sessions/{id}/stream`, and terminal /
session-updates WebSockets) can fail authentication mid-flight (token expiry). The contract defines a
state machine — see [`conformance/auth-lifecycle.json`](./conformance/auth-lifecycle.json):

```
connected ──auth-failure(401)──▶ failed ──begin-refresh──▶ refreshing
   refreshing ──refresh ok──▶ reconnecting ──reconnect ok──▶ resumed
   refreshing ──refresh fail──▶ prompt-relogin
   reconnecting ──reconnect fail──▶ prompt-relogin
connected ──auth-failure(403)──▶ prompt-relogin   (forbidden never auto-refreshes)
connected ──teardown──▶ closed                    (clean close on panel close / session switch)
```

The foundation ships this as a **documented, testable interface** (`onAuthFailure` / `refresh` /
`reconnect` / `teardown`). The actual transport wiring (attaching it to a live SSE/WS) is A5/A6 and
is intentionally NOT implemented here.

---

## 6. CLI login boundary

Login is a **documented function boundary**, not executed in tests:

- **omnigent CLI:** `omnigent login <url>` for a normal omnigent server with no usable token.
- **databricks CLI:** `databricks auth login` when a Databricks pointer record (or a Databricks
  workspace host) is the target.

Implementations **detect CLI presence first** (e.g. resolve the binary on `PATH`); on absence they
fall back to the manual server-URL + token override. A CLI is **never** hard-required (R4). The
foundation exposes the detection + the command spec; it does not spawn a login in unit tests.

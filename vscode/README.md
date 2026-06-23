# omnigent-vscode (foundation)

VS Code extension that brings Omnigent into the editor. This directory currently contains the
**foundation only** (Phase A steps A1–A4 of `.omc/plans/ralplan-omnigent-ide-extensions.md`):
config + server-target resolution, local-server discovery, and auth/token + the long-lived auth
lifecycle interface. The webview panel, native commands, and `.vsix` bundling are A5–A10 and are
not built yet.

## Layout

```
src/
├── extension.ts          # activate()/deactivate() — wires the foundation, redacted output channel
├── redact.ts             # secret-redaction helpers (never log tokens)
├── config/               # settings + server-target + host-type resolution (A2)
│   ├── index.ts          #   pure resolution (resolveServerTarget, hostTypeOf, ...)
│   └── vscodeSettings.ts #   thin vscode adapter (only place that touches the vscode API)
├── discovery/            # local-server discovery (A3)
│   ├── pidfile.ts        #   pure pidfile parse
│   ├── health.ts         #   pure /health interpretation + runtime probe
│   ├── liveness.ts       #   runtime PID liveness (process.kill(pid,0))
│   └── index.ts          #   injectable-IO discovery orchestrator
├── auth/                 # auth/token + lifecycle (A4)
│   ├── tokens.ts         #   pure token resolution (bearer vs databricks pointer)
│   ├── precedence.ts     #   pure precedence + authHeader()
│   ├── httpStatus.ts     #   pure 401/403 mapping
│   ├── lifecycle.ts      #   long-lived SSE/WS auth lifecycle state machine + interface
│   ├── cli.ts            #   CLI login boundary (omnigent/databricks; not executed in tests)
│   └── index.ts          #   injectable-IO token reader
└── test/vectors.ts       # loads docs/conformance/*.json (the shared contract)
```

The normative contract is `../docs/discovery-auth.md`; the executable conformance vectors are
`../docs/conformance/*.json` (shared verbatim with the future Kotlin/IntelliJ impl — keep them free
of language specifics).

## Build / test

```
npm install
npm run type-check   # tsc --noEmit
npm run build        # esbuild -> dist/extension.js
npm run test         # vitest run (conformance-driven unit tests; no IDE host / network)
```

## Carry-forward notes for A5–A10

- **A6 embed externals:** the bundled `ap-web` embed leaves React/ReactDOM/react-router(-dom) as
  bare externals — the webview bootstrap must supply React 18 + react-router-dom 6.4.x and a Router
  around `OmnigentApp`. See `apweb-pin.json` and `.omc/autopilot/A6a-embed-contract-gate.md`.
- **WS auth (Q2):** browsers cannot set headers on a WS handshake. Local single-user needs no WS
  auth (v1 path). Remote needs the token via query-string/subprotocol — confirm before AC4 on
  managed sessions.
- The auth lifecycle (`auth/lifecycle.ts`) is a documented interface only; wire it to a live SSE/WS
  transport in A5/A6.

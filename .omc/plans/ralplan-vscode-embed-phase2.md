# PLAN (FINAL, revised) — Monaco worker under webview CSP, E2E verification, OSS donation readiness

**Mode: SHORT.** Revision incorporates Architect verdict NEEDS-REVISION (A1–A3) and Critic verdict ITERATE (R-1…R-5), both convergent. Ready for execution. Full ADR at the end.

## Grounding (verified against source — cite when reviewing)

- **The override is OURS and is the root cause.** `third_party/omnigent/ap-web/src/shell/monacoSetup.ts:54-57`:
  ```ts
  self.MonacoEnvironment = {
    getWorker: () =>
      new Worker(new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url), { type: "module" }),
  };
  ```
  Its own comment (lines 46-53) states the design assumption: the `new Worker(new URL(..., import.meta.url))` idiom assumes the worker is served **same-origin** from the host CDN (true for Vite standalone / the rspack monolith). That assumption is false inside a VS Code webview, where the worker resolves to a cross-origin `*.vscode-cdn.net` resource URI relative to the `vscode-webview://` document. The bug is self-inflicted by this override.
- **This emits the bundled clobber** at `vscode/media/apweb/chunks/monacoCodeEditor-6hpgIomM.js:114125`: `self.MonacoEnvironment = { getWorker: () => new Worker(new URL("../assets/editor.worker-DQZqhwX7.js", import.meta.url).href, ...), { type: "module" }) }`. **Unconditional assignment** (pre-setting the global won't survive) of a **`{ type: "module" }`** worker (classic `importScripts` shims don't apply; a module-blob wrap is required). Filenames are content-hashed; the bundle is non-minified but generated — never regex-patch it.
- **Monaco already implements the exact blob-module fallback we need.** `Qp` (`:17353-17373`) is a three-branch worker factory; its `esmModuleLocation` branch calls `$p` (`:17375-17392`), which builds a `Blob` whose body is `await import(ttPolicy?.createScriptURL(t) ?? t)` and returns `URL.createObjectURL(...)` — i.e. the blob-module-worker we propose to build by hand is **Monaco's own native fallback**. The override sets a custom `getWorker`, so `Qp`'s first branch wins and `$p` is bypassed. This de-risks our mechanism (it's proven, not novel) and reveals the Option D seam.
- **Nested-worker risk (R2).** `Zp`/`createScriptURL` machinery (`:17352`, `:17359`, `:17368`) and the async worker-error emitters `em`/`nm` (`:17393-17419`) run in the worker's OWN global; a main-document `Worker` patch cannot reach them, and React error boundaries cannot catch async `worker.onerror` (Monaco swallows those internally). `monacoSetup.ts:34` imports `edcore.main.js` only (diff/links, no language services), so `editor.worker` is normally a **leaf** — confirm in Phase 0 (P0.2).
- **CSP today** (`vscode/src/panel/csp.ts:61-93`): `worker-src ${cspSource} blob:`, `script-src 'nonce-X' 'wasm-unsafe-eval' ${cspSource}`, **no `trusted-types` / `require-trusted-types-for` directive** → blob-worker creation and `createPolicy` are unrestricted today. The blob worker's `import(resourceUrl)` relies on the blob worker **inheriting the document CSP** (Chromium opaque-origin behavior) plus vscode-cdn.net serving CORS for webview resources — both true today but browser-version-dependent → an explicit Phase-0 observation, not just risk text.
- **Seams to reuse (don't rebuild):** `embedLocalResourceRoots()` in `host.ts:24-37` already lists `apweb`, `apweb/chunks`, `apweb/assets`, `apweb/vendor`, `bootstrap`. `bootstrap.ts:113` loads the embed via `await import("omnigent-embed")` (the choke point); `bootstrap.ts:110-123` already try/catches the entry import (Monaco is a later lazy sub-chunk). `buildCsp()` is pure/unit-tested (`csp.test.ts`). Monaco is the **sole** `new Worker` consumer under `media/apweb/` → the global-Worker-patch breadth risk is bounded.
- **Toolchain facts (corrected).** `Makefile:42`: ap-web **already builds with npm** (`cd ap-web && npm install && npm run build:embed`). Only the `vscode/` wrapper targets use `bun` (`Makefile:30,38,50`). `vscode/bun.lock` present; `vscode/package-lock.json` deleted. Upstream PR #1288 uses `npm ci` + `package-lock.json`. Artifacts gitignored (confirmed via `git check-ignore`: `media/apweb/`, `media/bootstrap/bootstrap.js`). Provenance: `vscode/apweb-pin.json` buildSha `84f4264a…` == submodule SHA. `retainContextWhenHidden: true` at `EditorPanelController.ts:63-64` (workers persist while hidden → lifecycle matters, see R-5). Tests: `vitest run` (265/265) + `tsc --noEmit`. No `launch.json` under `vscode/`.

---

## Phase 0 — Spike (gating). Two empirical questions + one mechanism proof. NOT a 3-way A/D selector. (½ day)

Phase 0 cannot empirically choose Option D: the override is baked into the built bundle and runs synchronously before `Qp` reads `MonacoEnvironment`, so to *test* D you must first *do* D (edit `monacoSetup.ts` → rebuild → re-vendor → re-pin). The A-vs-D choice is therefore an **ADR decision** (ship A now; D is donation-time consolidation), not a Phase-0 branch.

`make embed`, launch ext-dev-host against a local Omnigent server, set `omnigent.renderMode: "embed"`, open a Monaco route (diff/code view), open webview DevTools ("Developer: Open Webview Developer Tools").

- **P0.1 (empirical, gating):** Does bare `new Worker(<resource URI>, {type:'module'})` instantiate or throw? **Capture the exact error string** for the test fixture. If it works → no shim needed (drop Phase 1; keep Phase 2; record in ADR). If it throws (expected) → Phase 1.
- **P0.2 (empirical, gating):** Is `editor.worker` a leaf? Inspect DevTools for any nested worker spawn (the `Zp` path). Sets R2 severity: if non-leaf, the degrade net becomes load-bearing rather than belt-and-suspenders.
- **P0.3 (mechanism proof, only if P0.1 fails):** Paste one snippet in webview DevTools to prove the blob-module wrap loads under our CSP **before building anything**:
  ```js
  new Worker(URL.createObjectURL(new Blob(['import "'+absUrl+'"'],{type:'application/javascript'})),{type:'module'})
  ```
  This validates the mechanism that **both A (now) and D (later) share** — it is **not** an A/D selector. Also record the CSP/CORS observation from the Grounding block (blob worker inherits document CSP; cdn serves CORS).

**Acceptance:** P0.1 error string captured; P0.2 leaf/non-leaf recorded; if P0.1 fails, P0.3 proves the blob wrap loads with zero CSP violations.

---

## Phase 1 — Option A: wrap `globalThis.Worker` in bootstrap (the load path, no cross-repo coordination)

**Seam:** wrap `globalThis.Worker` in `bootstrap.ts` BEFORE the first `import("omnigent-embed")` (`bootstrap.ts:48` vs `:113`; Monaco constructs workers only on first editor mount, so the patch is installed in time, same realm). Survives the unconditional clobber (the clobbered `getWorker` still calls our patched `Worker`), hash-agnostic, no edits to generated code. Breadth bounded: Monaco is the only Worker consumer under `media/apweb/`.

**Files to touch:**
- **New: `vscode/media/bootstrap/monacoWorkerShim.ts`** — pure helper + installer:
  - `buildWorkerSpec(rawUrl, documentOrigin, opts?): { url, options?, revoke?: boolean }` — pure, unit-testable. `blob:` / `data:` / same-origin → **passthrough** (`revoke:false`). Cross-origin → return a `blob:` URL: module worker body `import ${JSON.stringify(absUrl)};` (created `{type:'module'}`), classic worker body `importScripts(${JSON.stringify(absUrl)});`; preserve `opts.type`/`name`; `revoke:true`.
  - `installWorkerShim()` — wraps `globalThis.Worker` via subclass/Proxy running `buildWorkerSpec` on construction. **Revoke the object URL immediately after `super(url, opts)` returns** when `revoke:true` (the worker has already fetched the module; standard pattern — prevents the blob-URL leak under `retainContextWhenHidden`). Idempotent (Symbol/flag guard).
- **Edit: `vscode/media/bootstrap/bootstrap.ts`** — call `installWorkerShim()` at top-of-module (~`:48`), before the `message` listener and well before `import("omnigent-embed")`.
- **`vscode/scripts/build-bootstrap.js`** — no change; shim bundles into `bootstrap.js` (imports nothing external). Confirm it is NOT added to the `external` list.
- **`vscode/src/panel/csp.ts`** — likely **no change** (blob covered by `worker-src blob:`; the blob worker's `import(realUrl)` is a script fetch covered by `script-src ${cspSource}`). Touch only if Phase 0/1 DevTools shows a violation; then add the resource origin explicitly (already implied by `cspSource`).

**Trusted Types contingency (document, don't build):** TT not enforced today. If a future VS Code build enforces `require-trusted-types-for 'script'` on webviews, blob-URL creation needs a named `createScriptURL` policy + a `trusted-types` directive. Risk, not Phase-1 work.

**A↔D coexistence (assert, don't hand-wave):** `buildWorkerSpec` passes through `blob:`/`data:`/same-origin untouched, so Option D's output (a `blob:` or same-origin URL emitted by the fixed `monacoSetup.ts`) is passed through with **no double-wrap**. This is exactly what makes A and D safe to co-exist during the donation transition (see ADR Follow-ups + R-2 test case).

**Acceptance:**
- Phase-0 failing repro now succeeds: Monaco diff/code view renders with working features (hover/links/diff gutters), no CSP violation.
- `buildWorkerSpec` unit matrix green: cross-origin module → blob `{type:module}`+`revoke:true`; cross-origin classic → blob importScripts; same-origin → passthrough; `blob:` passthrough; `data:` passthrough; **`import-blob-from-D` (a `blob:` URL) → passthrough (no double-wrap)**; revocation asserted post-construction.
- `installWorkerShim()` idempotent and installed before any embed import.

---

## Phase 2 — Degrade safety net (re-scoped to the correct failure mode)

**What the React `ErrorBoundary` actually contains (corrected):** it catches **lazy-chunk-load failures** (`lazy(() => import(MonacoCodeEditor))`) and **synchronous render/commit-phase throws** — the real white-screen risks. It does **NOT** catch async `worker.onerror` from a dead editor.worker: Monaco surfaces those via its internal `em`/`nm` emitters (`:17393-17419`) and swallows them. A dead worker = **degraded-but-rendered** editor (text shows; diff gutters/links absent), not a crash.

**Files to touch:**
- **Edit: `vscode/media/bootstrap/bootstrap.ts`** — wrap `<OmnigentApp>` (the `AppWrapper`, ~`:129`) in a local class `ErrorBoundary` (same React instance via the import-map — confirmed shared, `host.ts:120-128` ↔ `vite.embed.config.ts:231-237`) that renders a "Code/diff view unavailable in embed mode" panel for chunk-load/render failures and keeps the rest of the app mounted.
- Confirm (read-only, Phase 0 DevTools network tab) the **chat/input surface never requests `monacoCodeEditor`/`MonacoCodeEditor` chunks** — Monaco is lazy, so the primary copy/paste goal is structurally isolated.

**Acceptance:** the only automatable Phase-2 assertion is the `buildWorkerSpec` blob/passthrough/revocation matrix (Phase 1). The **degrade-path verification is MANUAL** → Phase-3 checklist item 6. Phase-2 "acceptance" points there; it asserts "chat unaffected + degraded-or-fallback Monaco + no white-screen," NOT "fallback panel always appears" (a worker failure yields a degraded editor, not the panel).

---

## Phase 3 — End-to-end verification (Extension Development Host)

**Automatable (real smokes):**
- **`vscode/media/bootstrap/monacoWorkerShim.test.ts`** (vitest) — the full `buildWorkerSpec` matrix above incl. the `import-blob-from-D → passthrough` and post-construction revocation cases.
- **Artifact-manifest smoke** (`make verify-embed` or vitest): after `make embed`, assert presence (hash-agnostic globs) of `media/apweb/omnigent-embed.js`, `media/apweb/omnigent-embed.css`, ≥1 `media/apweb/assets/editor.worker-*.js`, all 6 `media/apweb/vendor/*.js`, `media/bootstrap/bootstrap.js`. Fails CI on `make embed` drift.
- Keep `tsc --noEmit` + `vitest run` green (currently 265/265).

**Manual checklist (codify in `vscode/docs/embed-verification.md`):**
1. **SPA mount:** embed renders `<OmnigentApp>`, no placeholder, `omnigent/ready` posted.
2. **Routing / deep-link:** `omnigent/init` with a non-`/` route lands; a later `omnigent/navigate` drives the router (embed path structurally immune to the iframe `/c/x/c/x` doubling — confirm).
3. **Copy/paste (THE goal):** Cmd+C / Cmd+V work in chat inputs on macOS.
4. **SSE stream:** chat streams via the fetcher closure (token in `Authorization` header, never URL); confirm fetch-reader path in DevTools.
5. **WebSocket terminal:** connects via `resolveWebSocketUrl`; local server needs no token; round-trips.
6. **Monaco + degrade (re-scoped, MANUAL):** diff + code views render with working features (validates Phase 1). Then **force a worker failure** (rename `editor.worker-*.js` or break the shim URL) and confirm: (a) chat input + copy/paste unaffected; (b) Monaco route shows the **fallback panel on a chunk-load failure** OR a **degraded editor on a worker failure**; (c) no uncaught white-screen.
7. **Worker lifecycle (MANUAL, R-5):** open/close several Monaco routes; confirm worker count does not grow unbounded in DevTools (verifies Monaco disposes `editor.worker` on unmount under `retainContextWhenHidden:true`). If it grows, **file a follow-up** — out of scope to fix here, but must be observed.

**Acceptance:** all manual items pass against a local server; both automated smokes pass; checklist doc committed.

---

## Phase 4 — OSS donation readiness (future slice after PR #1288; decisions locked now)

1. **Lockfile (DECISION LOCKED, implementation deferred):** donated `editors/vscode/` **single-sources on npm + committed `package-lock.json`** (currently deleted — regenerate from public npm). `bun` is **dev-only and never gates the build**. **ap-web's npm build is unaffected** (`Makefile:42` already npm). Convert only the `vscode/` wrapper Makefile targets' `bun run` → `npm run` for the donated path; add a drift-guard script (assert top-level versions in `bun.lock` agree with `package-lock.json`, or simply don't commit `bun.lock` to the donated path). No lingering open question.
2. **Embed-bundle sourcing — DONATION CRITICAL-PATH BLOCKER (not a side note):** `make embed` → `build-apweb` requires the `third_party/omnigent` submodule + `npm run build:embed`; upstream `editors/vscode/` has no such submodule. This is the single biggest donation unknown. Must be resolved before donation: decide how upstream CI sources the embed bundle (vendored prebuilt artifact + provenance check, an upstream `build:embed` job, or a submodule/path equivalent). Blocks donation; does NOT block Phases 0-3.
3. **Provenance:** add `make verify-pin` (compare `git submodule status` SHA to `apweb-pin.json.buildSha`; fail on drift). Residual weakness (accepted): proves pin==submodule at verify time, not that vendored `media/apweb/` artifacts were built from that SHA — true provenance needs a rebuild.
4. **Keep seams pure/testable:** `csp.ts`/`html.ts`/`iframeHtml.ts`/`host.ts`/`monacoWorkerShim.ts` stay free of live VS Code API in their pure cores so they port unchanged.

**Acceptance:** committed `package-lock.json` + drift guard for the donated tree; documented resolution path for embed-bundle sourcing (blocker #2); `make verify-pin` green; no committed build artifacts.

---

# ADR — Monaco worker in the same-origin embed webview

**Status:** Accepted (SHORT mode). **Context:** macOS VS Code does not deliver Cmd+C/V into cross-origin iframes (microsoft/vscode#129178, #182642), so the default `iframe` renderMode breaks copy/paste in app inputs. The same-origin `embed` mode fixes that but loads ap-web's Vite intermediate directly in the webview, where `monacoSetup.ts`'s `getWorker` override constructs a **cross-origin module Worker** that the webview blocks.

**Decision:** Ship **Option A** (wrap `globalThis.Worker` in `bootstrap.ts` with a pure `buildWorkerSpec` that passes through same-origin/blob/data and blob-module-wraps cross-origin module workers) as the robust, no-cross-repo-coordination default, gated behind the Phase-0 spike (P0.1/P0.3). Pair it with a **re-scoped React ErrorBoundary** (chunk-load/render failures) and a **manual degrade verification** (worker failures = degraded editor). Record **Option D** (fix `monacoSetup.ts:54-57` at source to mirror Monaco's `$p` blob-wrap, or set `esmModuleLocation` and delete the override so `$p` fires natively) as the **donation-time consolidation**.

**Decision drivers:** (1) robustness to the unconditional `self.MonacoEnvironment` clobber + content-hashed filenames; (2) module-worker + cross-origin reality (no classic `importScripts` shim); (3) velocity now without cross-repo submodule→rebuild→re-pin coordination; (4) donation portability later.

**Alternatives considered:**
- **A — runtime `globalThis.Worker` wrap [CHOSEN now].** Survives the clobber; hash-agnostic; zero generated-code edits; one seam; pure/testable; breadth bounded (Monaco is the sole Worker consumer). Con: a runtime monkey-patch we don't want to carry forever → retired by D at donation.
- **B — build-time regex patch of the generated bundle [REJECTED].** Brittle against non-minified-but-generated, content-hashed output; re-applied every rebuild; hostile to donation. Violates revised Principle 1.
- **C — degrade only [REJECTED as sole solution; RETAINED as the Phase-2 net].** Simplest, zero shim risk, but ships broken diff/code views. Acceptable as a floor, not a ceiling.
- **D — source fix in `monacoSetup.ts:54-57` [CHOSEN for donation-time].** Fixes the exact 5 lines causing the bug; avoids the global-Worker patch; reuses Monaco's own `$p` pattern; legitimately upstreamable ("make Monaco workers load in cross-origin/CSP-restricted embed hosts"). Con: turns a one-file extension change into a submodule edit → rebuild → re-pin cycle and only helps once a consuming extension pins an ap-web SHA containing it — i.e. cross-repo coordination, which is why it is donation-time, not now. **Phase 0 does NOT empirically select D** (you'd have to do D to test D).

**Why chosen:** A is the only option that fixes copy/paste **today** with no submodule coordination and survives whatever the regenerated bundle does. The irreducible tension is coordination-locus (A, inside the extension) vs root-cause-locus (D, inside owned source): you cannot fix-at-source without rebuilding/re-pinning the submodule. We take A's velocity now and D's cleanliness at donation.

**Consequences:** (+) copy/paste fixed; Monaco diffs work; no generated-code edits; bounded breadth. (−) we carry a runtime `globalThis.Worker` wrap until D lands; `buildWorkerSpec` must revoke blob URLs (R-5) to avoid leaks under `retainContextWhenHidden:true`; the degrade net only covers chunk-load/render, not async worker errors (a dead worker = degraded editor, accepted).

**Follow-ups:** (1) At donation, implement D in `monacoSetup.ts`, rebuild ap-web, bump `apweb-pin.json.buildSha`; **retire Option A only after** the pinned SHA contains the fix, verified by Phase-0 P0.1 passing with the shim removed (A↔D safe to co-exist meanwhile because `buildWorkerSpec` passes D's blob/same-origin output through untouched). (2) Resolve the donation embed-bundle sourcing blocker (Phase 4 #2). (3) Land the npm `package-lock.json` + drift guard. (4) If P0.2/Phase-3 item 7 show a non-leaf worker or unbounded worker growth, file a follow-up — the degrade net becomes load-bearing.

---

# RALPLAN-DR Summary

### Principles (4)
1. **Don't patch *generated* output; prefer stable runtime seams *or the owning source*, never regex on hashed bundles.** (Runtime seam = Option A now; owning source = Option D at donation; regex on the bundle = Option B, rejected.)
2. **The actual goal is copy/paste, not Monaco.** Monaco is lazy and off the chat/input path; nothing in the Monaco fix may regress the input surface.
3. **Pure seams stay pure.** `buildWorkerSpec` is a pure, unit-tested function — tests without an IDE host, ports to the OSS tree unchanged.
4. **Reproducible, never committed.** Artifacts stay gitignored with honest pin provenance; CI rebuilds via `make embed`.

### Decision Drivers (top 3)
1. Robustness to the unconditional `self.MonacoEnvironment` clobber + content-hashed filenames.
2. Module-worker + cross-origin reality (no classic `importScripts` shim).
3. Velocity-now vs donation-portability (the A-vs-D coordination tension).

### Viable Options (Monaco-worker problem)
| Option | Seam | Pros | Cons / Status |
|---|---|---|---|
| **A — runtime `globalThis.Worker` wrap** | `bootstrap.ts` | survives clobber; hash-agnostic; no generated-code edits; pure/testable; bounded breadth | runtime monkey-patch; **CHOSEN now** |
| **B — regex-patch generated bundle** | `make embed` | "inside" the bundle | brittle on hashed/generated output; anti-donation; **REJECTED** (violates Principle 1) |
| **C — degrade only** | `bootstrap.ts` ErrorBoundary | simplest; no shim risk | ships broken diffs; **REJECTED as sole**, **RETAINED as Phase-2 net** |
| **D — source fix in `monacoSetup.ts:54-57`** | submodule source | fixes exact root cause; reuses Monaco's `$p`; upstreamable | needs submodule rebuild+re-pin; cross-repo coordination; **CHOSEN for donation-time** |

**Named tradeoff (A vs D):** velocity / no-coordination (A) vs root-cause / donation-clean (D). Irreducible: you cannot fix-at-source without rebuilding/re-pinning the submodule. Resolution: A now, D at donation; safe to co-exist because A passes through D's blob/same-origin output.

### Risks + Mitigations
- **R1: bare `new Worker(resourceUri)` works → shim unneeded.** → P0.1 gates; drop Phase 1, keep Phase 2, record in ADR.
- **R2: editor.worker non-leaf (nested Zp spawn).** → P0.2 settles severity; degrade net becomes load-bearing if non-leaf.
- **R3: future VS Code enforces Trusted Types.** → not enforced today; contingency = named `createScriptURL` policy + `trusted-types` directive.
- **R4: CSP/CORS blocks the blob worker's `import(realUrl)`.** → covered by `worker-src blob:` + `script-src ${cspSource}`; blob inherits document CSP + cdn CORS, browser-version-dependent → explicit P0.3 observation.
- **R5: blob-URL / worker lifecycle leak.** → revoke object URL right after `super(url,opts)`; test asserts revocation; Phase-3 item 7 observes worker count under `retainContextWhenHidden:true`.
- **R6: most E2E is manual.** → checklist doc + two automated smokes (buildWorkerSpec matrix, artifact manifest).
- **R7 (donation): embed-bundle sourcing upstream.** → CRITICAL-PATH blocker (Phase 4 #2); resolve before donation.

### Testable Acceptance Criteria
1. P0.1 error string captured; P0.2 leaf/non-leaf recorded; P0.3 proves blob wrap loads with zero CSP violations.
2. `buildWorkerSpec` matrix green incl. `import-blob-from-D → passthrough` and post-construction revocation; `installWorkerShim` idempotent + pre-embed-import.
3. Manual: forced worker failure → chat + copy/paste unaffected; Monaco route degraded (worker) or fallback panel (chunk-load); no white-screen.
4. Manual: worker count does not grow unbounded across open/close cycles.
5. Manual checklist (mount, deep-link/navigate, copy/paste, SSE, WS terminal, Monaco) passes against a local server.
6. Artifact-manifest smoke + `make verify-pin` green; `tsc --noEmit` + `vitest run` stay green.
7. Donated tree: committed `package-lock.json` + drift guard; documented embed-bundle sourcing resolution (R7).

### Concrete verification steps
`make embed` → launch ext-dev-host (no `launch.json`; use `code --extensionDevelopmentPath=vscode` or add one) → `omnigent.renderMode:"embed"` → webview DevTools → run P0.1/P0.2 (+P0.3 if P0.1 fails) → build Phase 1/2 → walk the 7-item manual checklist → `cd vscode && bun run type-check && bun run test` → run artifact-manifest + `make verify-pin`.

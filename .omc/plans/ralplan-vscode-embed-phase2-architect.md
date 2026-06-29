# Architect Review — ralplan-vscode-embed-phase2

**Verdict: NEEDS-REVISION** (not a rejection — Option A is sound; three targeted fixes required)

## Summary
The plan is well-grounded and its core empirical claims check out against the bundle. Option A (wrap `globalThis.Worker` in `bootstrap.ts` + blob-module shim) is a *defensible, robust* default, and gating it behind a Phase-0 spike is the plan's strongest move. **But the plan omits the actual root-cause fix entirely** — the naive worker construction lives in `third_party/omnigent/ap-web/src/shell/monacoSetup.ts:52-57`, which is *ours to edit*, and Monaco's own factory (`$p`, `monacoCodeEditor-6hpgIomM.js:17375-17392`) already does the blob-wrap the plan wants. Two further issues: the Phase-2 degrade net mislabels the failure mode it claims to contain, and the dual-lockfile recommendation invites silent drift.

## Analysis (claims verified against the code)

**The clobber is real — confirmed.** `monacoCodeEditor-6hpgIomM.js:114125` is exactly `self.MonacoEnvironment = { getWorker: () => new Worker(new URL(... "../assets/editor.worker-DQZqhwX7.js", import.meta.url).href ...), { type: "module" }) }`. Unconditional assignment; module worker. The plan's quote and its two derived facts are accurate. Pre-setting the global will not survive.

**The source of the clobber is OURS — and the plan never mentions it.** `monacoSetup.ts:52-57` is the exact source that emits line 114125. Its own comment (lines 46-51) states the design intent: `new Worker(new URL(..., import.meta.url))` is the "build-tool-agnostic idiom" that assumes the worker is served **same-origin from the host's CDN**. That assumption is the true root cause — in a VS Code webview the worker resolves to a cross-origin `*.vscode-cdn.net` resource URI relative to the `vscode-webview://` document. The bug is self-inflicted by this override, not an inherent Monaco/VS Code incompatibility.

**Monaco already solves this exact problem.** `Qp` (`:17353`) routes through three branches; the `esmModuleLocation` branch calls `$p` (`:17375-17392`), which builds a `Blob` whose body is `await import(ttPolicy?.createScriptURL(t) ?? t)` and returns `URL.createObjectURL(...)` — i.e., **the blob-module-worker the plan proposes to build by hand is Monaco's own native fallback.** The omnigent override at line 114125 sets a custom `getWorker`, so `Qp`'s *first* branch wins and `$p` is bypassed. This both (a) de-risks Option A's mechanism (it's proven, not novel) and (b) reveals a cheaper seam the plan didn't consider.

**Nested-worker risk (R2) is real but the editor.worker is likely a leaf.** The `Zp`/`createScriptURL` machinery (`:17352`, `:17359`, `:17368`) runs in the worker's own global; a main-document patch cannot reach it. `monacoSetup.ts:34` deliberately imports `edcore.main.js` only (no language services/workers), so the spawned `editor.worker` does diff/links and is normally a leaf. Confirm in Phase 0, as planned.

**CSP claims hold.** `csp.ts:91-93` emits `worker-src ${cspSource} blob:`; `:61-63` emits `script-src 'nonce' 'wasm-unsafe-eval' ${cspSource}`; no `trusted-types`/`require-trusted-types-for` directive. Blob worker creation and `createPolicy` are unrestricted today. The blob worker's `import(resourceUrl)` relies on the blob worker **inheriting the document CSP** (Chromium behavior for opaque-origin workers) plus vscode-cdn.net serving CORS for webview resources — both true today but browser-version-dependent; make this an explicit Phase-0 observation, not just R4 text.

**Other spot-checks.** Only `monacoCodeEditor-6hpgIomM.js` constructs `new Worker` under `media/apweb/` — Monaco is the *sole* Worker consumer, which materially lowers the "global Worker patch is too broad" objection. `retainContextWhenHidden: true` confirmed at `EditorPanelController.ts:64` against a 1.8 MB entry + 718 chunks. `bun.lock` present, `package-lock.json` absent — confirmed. React identity is structurally sound: `vite.embed.config.ts:231-237` externalizes the same react/react-dom/jsx-runtime/react-router(-dom) set that `host.ts:120-128` feeds the import-map, so bootstrap's React (and a bootstrap-local ErrorBoundary) share the embed's reconciler instance.

## Root Cause
Two layers. Proximate: `monacoSetup.ts:52-57` overrides `MonacoEnvironment.getWorker` with a naive cross-origin `new Worker(url, {type:'module'})` that VS Code's webview blocks. Underlying: that override assumes a same-origin worker host (true for the rspack monolith CDN, false for the webview), and in doing so it *bypasses Monaco's own built-in cross-origin blob-wrap fallback*. The plan treats the symptom (runtime Worker construction) without naming the source that creates it.

---

## (a) Steelman antithesis to the recommended Worker-shim approach
**The recommended fix patches the wrong layer.** The plan's Principle 1 — "Survive the bundle, don't fork it" — correctly rules out regex-patching *generated output* (Option B). But it then over-applies that principle to exclude editing the *source that generates the bundle*, even though the task explicitly states the submodule is ours to rebuild. The naive worker is five lines in `monacoSetup.ts:52-57`. The minimal, root-cause fix (**Option D**) is to make that override replicate Monaco's own `$p` blob-wrap (or set `esmModuleLocation` and delete the override so `$p` fires natively):

```ts
// monacoSetup.ts — same-origin passthrough, cross-origin blob-wrap (mirrors $p)
self.MonacoEnvironment = { getWorker: () => {
  const real = new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url).href;
  const sameOrigin = real.startsWith(globalThis.origin);
  const url = sameOrigin ? real
    : URL.createObjectURL(new Blob([`import ${JSON.stringify(real)};`], { type: "application/javascript" }));
  return new Worker(url, { type: "module" });
}};
```

Versus Option A, Option D: (1) fixes the exact line that causes the bug; (2) avoids monkey-patching `globalThis.Worker` (a subclass/Proxy that intercepts *every* Worker construction app-wide and alters `Worker` identity); (3) reuses a pattern that is literally Monaco's own; (4) is **more donation-justifiable than the plan implies** — "make Monaco workers load in cross-origin/CSP-restricted embed hosts" is a legitimate upstream ap-web improvement, not a VS-Code-specific hack. The plan's claim that Option A is the *cleaner* seam rests on treating ap-web as immutably external — which contradicts the stated premise that it's ours.

## (b) Named tradeoff tension(s)
**Tension 1 — Coordination locus vs. root-cause locus (irreducible).** Option A keeps the fix entirely inside the extension (`bootstrap.ts`) — no submodule bump, no `apweb-pin.json` buildSha churn, works regardless of what the bundle does, and ships today without cross-repo coordination. Option D fixes the root cause but turns a one-file extension change into a submodule edit → rebuild → re-pin cycle, and only helps if the consuming extension pins an ap-web version that contains the fix. You cannot have both "fix it at the source" and "fix it without touching/rebuilding the submodule." For *velocity now*, A wins; for *donation correctness and not carrying a perpetual runtime monkey-patch*, D wins. The plan hides this by never surfacing D.

**Tension 2 — Dual lockfiles.** Internal Makefile uses `bun` (`bun.lock`); upstream PR #1288 uses `npm ci` (`package-lock.json`). Maintaining both means two resolvers can pin different transitive versions → "builds internally, breaks (or subtly differs) upstream." The plan's "keep bun.lock internal-only" defers this without a drift guard.

## (c) Synthesis / specific recommended changes
1. **Spike all three branches in Phase 0, not two.** Branch on: (a) bare worker works → no fix; (b) `$p`/`esmModuleLocation` native path works with the override removed → **Option D**; (c) neither → **Option A**. In the *same* DevTools session, manually run the blob-wrap (`new Worker(URL.createObjectURL(new Blob([` + "`import \"${absUrl}\"`" + `],{type:'application/javascript'})),{type:'module'})`) to *prove* the mechanism loads before building anything. Converts Phase 1 from "build on hypothesis" to "build on verified fact" and stops Option A from being pre-committed.
2. **Ship Option A now as the robust default** (no-coordination path; survives any bundle), but **scope the wrap narrowly**: passthrough on same-origin/blob/data (already specified) *and* document that Monaco is the only Worker consumer so breadth risk is bounded. Keep `buildWorkerSpec` pure/tested as planned.
3. **Record Option D as the donation-time consolidation** in the ADR: when ap-web is rebuilt for upstream, fix `monacoSetup.ts` at source and retire the runtime patch so the donated extension does not carry a perpetual `globalThis.Worker` monkey-patch. Preserves A's velocity now and D's cleanliness later.
4. **Lockfile:** make the donated `editors/vscode/` single-source on **npm + committed `package-lock.json`**; treat `bun` as a dev-only convenience that never gates the build, and add a CI assertion that `bun.lock` and `package-lock.json` agree on top-level versions (fail on drift) — or simply don't commit `bun.lock` to the donated path.

## (d) Principle violations
- **Principle 1 ("Survive the bundle, don't fork it") — MEDIUM, framing violation.** As worded it conflates "don't regex generated output" (correct) with "don't touch owned source that generates it" (incorrect, given the submodule is ours). This framing is what silently excluded Option D from the options table. Reword to: "Don't patch *generated* output; prefer stable runtime seams *or the owning source*, never regex on hashed bundles."
- **Phase-2 degrade net mislabels its failure mode — MEDIUM, correctness of the safety argument.** Phase 2 claims the React `ErrorBoundary` contains "nested worker spawn failure." It cannot: a nested/editor worker failure surfaces as an **async `worker.onerror`** inside Monaco's own `nm`/`em` error emitters (`:17393-17419`), which Monaco swallows internally — React error boundaries do not catch async or worker-thread errors. The boundary *does* legitimately catch (a) a failed `lazy(() => import(MonacoCodeEditor))` chunk load and (b) synchronous throws during commit-phase effects — and those, not worker spawns, are the real white-screen risks. Keep the boundary, but **re-scope its stated purpose to chunk-load/render failures**, and for the worker path either subscribe to Monaco's worker `onError`/`onUnexpectedError` or accept (and verify in Phase 0) that a dead worker = *degraded-but-not-crashed* editor. The Phase-2 acceptance test ("point shim at a bad URL") likely exercises async worker failure, which the boundary won't catch — so the test as written may pass for the wrong reason or hang. Fix it to assert "editor renders degraded, chat unaffected," not "fallback panel appears."

## (e) Verdict + top 3 must-fix items

**VERDICT: NEEDS-REVISION** — not a rejection. Option A is sound and the Phase-0 gate is excellent.

1. **Add Option D (source fix in `monacoSetup.ts:52-57`) to the options table and make Phase 0 a 3-way branch.** Reword Principle 1 so it no longer excludes editing owned source. Ship A now, record D as the donation-time consolidation. (Otherwise the plan carries a permanent `globalThis.Worker` monkey-patch it didn't have to.)
2. **Re-scope the Phase-2 degrade net.** State that the React ErrorBoundary contains chunk-load + render failures (real white-screen risk), NOT async worker-spawn failures (Monaco swallows those). Add a Monaco-level error hook or explicitly verify "dead worker = degraded editor, not crash" in Phase 0, and fix the force-fail acceptance test accordingly.
3. **Resolve the lockfile to a single source for the donated tree (npm + committed `package-lock.json`)** with a CI drift guard against `bun.lock`, rather than maintaining both unguarded.

## References
- `third_party/omnigent/ap-web/src/shell/monacoSetup.ts:52-57` — naive `getWorker` override; the true source of the clobber (ours to edit); comment lines 46-51 reveal the same-origin assumption that breaks under the webview.
- `vscode/media/apweb/chunks/monacoCodeEditor-6hpgIomM.js:114125-114129` — the bundled override (matches the plan's quote).
- `…monacoCodeEditor-6hpgIomM.js:17353-17373` (`Qp`) — three-branch worker factory; custom `getWorker` short-circuits the native fallback.
- `…monacoCodeEditor-6hpgIomM.js:17375-17392` (`$p`) — Monaco's own blob-module-worker (`import(t)` + `URL.createObjectURL`); the exact mechanism Phase 1 proposes to rebuild.
- `…monacoCodeEditor-6hpgIomM.js:17393-17419` (`em`/`nm`) — worker errors surface async via internal emitters, not as React throws (degrade-net concern).
- `vscode/src/panel/csp.ts:61-93` — `script-src`/`worker-src` confirm blob + cspSource coverage; no trusted-types directive.
- `vscode/media/bootstrap/bootstrap.ts:48-61, 110-143` — the `import("omnigent-embed")` choke point and `AppWrapper`/MemoryRouter (embed nav is structurally immune to the `/c/x/c/x` doubling).
- `vscode/src/panel/host.ts:24-37, 120-128` — `embedLocalResourceRoots` + import-map; React-identity sharing.
- `third_party/omnigent/ap-web/vite.embed.config.ts:231-247, 273-293` — `base: "./"`, SHARED_EXTERNALS, preserved code-splitting; the relative `new URL` design that assumes same-origin serving.
- `vscode/src/panel/EditorPanelController.ts:63-64` — `retainContextWhenHidden: true` (memory tradeoff for the 1.8 MB / 718-chunk bundle; no explicit worker teardown verification).

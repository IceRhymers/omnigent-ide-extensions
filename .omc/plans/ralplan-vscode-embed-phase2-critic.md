# Critic Review — ralplan-vscode-embed-phase2

**VERDICT: ITERATE** (one focused revision pass; the spine is sound, the architect's 3 must-fixes are correct, but they introduced/left 5 executable gaps)

## Overall Assessment
The plan is well-grounded; every load-bearing empirical claim verified against source (monacoSetup.ts:52-57, csp.ts:91-93, bootstrap.ts:110-143, host.ts:120-128, Makefile:41-50, apweb-pin.json↔submodule SHA). The architect's three must-fixes (Option D, degrade-net re-scope, single-source lockfile) are correct and necessary. They are NOT sufficient: must-fix #1's "3-way Phase-0 spike" is internally inconsistent and not executable as written; the A↔D coexistence/retirement sequencing is unspecified; the re-scoped Phase-2 degrade test is manual, not automatable as the plan implies; nobody addressed blob-URL revocation / worker teardown; and Phase-4's lockfile "open question" should be closed to a decision, not deferred open.

## Verification of the architect's 3 must-fixes
- **#1 Option D + reword Principle 1 — CORRECT.** monacoSetup.ts:52-57 is exactly the source of the bundled clobber; its comment (lines 46-51) literally states the same-origin CDN assumption that breaks under the webview. The submodule is ours (Makefile:13,41-42 builds it from source). Principle 1 as worded does conflate "don't regex generated output" with "don't touch owned source." Reword is justified.
- **#2 Degrade-net re-scope — CORRECT.** bootstrap.ts:110-123 already try/catches the embed *entry* import; Monaco is a *later lazy sub-chunk*, so a React ErrorBoundary around AppWrapper legitimately catches lazy-chunk-load + render throws, NOT async worker-spawn errors. The "point shim at a bad URL" force-fail test does exercise async worker failure → boundary won't catch → test passes for the wrong reason or hangs. Confirmed.
- **#3 Single-source lockfile — CORRECT but the framing in BOTH docs is wrong about the facts (see R-3 below).**

## Required Revisions (numbered, each tied to a Critic criterion)

### R-1 (CRITICAL — verification-step decidability) — Phase-0 is NOT a decidable 3-way spike; reframe it
The architect's must-fix #1 says branch on "(b) $p/esmModuleLocation native path works with the override removed → Option D." That branch is **not observable in a DevTools session against the currently-built bundle**: the override is baked into `monacoCodeEditor-…js:114125` and runs synchronously as a side-effect of importing monacoSetup before `Qp` ever reads `MonacoEnvironment`. To test branch (b) you must first edit monacoSetup.ts, rebuild ap-web, re-vendor, re-pin — i.e., you must *do* Option D to *test* Option D. The "manually run the blob-wrap in the same DevTools session" step only proves the **shared** mechanism that BOTH A and D use; it cannot discriminate (b) from (c).

This also contradicts the architect's own synthesis ("ship A now, record D as donation-time consolidation") — if D is deferred regardless, Phase 0 never selects it.

**Fix:** Specify Phase 0 as exactly two empirical questions plus one mechanism-proof, and move the A-vs-D choice out of Phase 0 into the ADR as a documented architectural decision:
- P0.1 (empirical, gating): Does bare `new Worker(<resource URI>, {type:'module'})` instantiate or throw? Capture the exact error string.
- P0.2 (empirical, gating): Is `editor.worker` a leaf? Inspect for any nested worker spawn (Zp path) — decides R2 severity.
- P0.3 (mechanism proof, only if P0.1 fails): paste one snippet in webview DevTools — `new Worker(URL.createObjectURL(new Blob(['import "'+absUrl+'"'],{type:'application/javascript'})),{type:'module'})` — to prove the blob-module wrap loads under CSP before building anything. This validates the mechanism A ships now AND the mechanism D ships later; it is not an A/D selector.
- Decision: ship A now (no cross-repo coordination); record D as the donation-time consolidation. State explicitly that Phase 0 does NOT empirically choose D.

### R-2 (MAJOR — principle/option consistency + coherence) — Specify A↔D coexistence and the retirement gate
The task asks whether A+D conflict. They do not, *because* `buildWorkerSpec` passes through `blob:`/`data:`/same-origin (plan line 47): D emits a `blob:` (cross-origin) or same-origin URL, both of which A passes through untouched — no double-wrap. But the plan never states this, and the architect's "retire the runtime patch" (synthesis #3) has an unspecified ordering hazard: if A is removed before the pinned ap-web SHA actually contains D, Monaco breaks; if D ships but A is left installed, you silently carry both.

**Fix:** Add to the ADR: (a) A's passthrough on `blob:`/same-origin is what makes A+D safe to co-exist during transition — assert it in the `buildWorkerSpec` test matrix ("blob passthrough" case already listed; add an explicit `import-blob-from-D → passthrough` case); (b) the retirement of A is gated on `apweb-pin.json.buildSha` advancing to a commit that contains the monacoSetup.ts fix, verified by Phase-0 P0.1 passing with the shim removed. One sentence each.

### R-3 (MAJOR — scope honesty, lockfile facts wrong in both docs) — Close the lockfile open-question with the real toolchain
Both docs imply the split is "internal bun vs upstream npm." The Makefile shows it is finer-grained: **ap-web already builds with `npm` (Makefile:42 `cd ap-web && npm install && npm run build:embed`)**; only the `vscode/` extension's own scripts use `bun` (Makefile:30,38,50,63,71). So "convert the Makefile's bun run calls to npm" only touches the `vscode/` wrapper targets, and a donated `editors/vscode/` needs a committed `vscode/package-lock.json` (currently deleted) — ap-web's resolver is already npm and is not the problem.

Plan Phase 4 item 1 still ends with an *open question* ("maintain both, or standardize on npm?"). The architect's must-fix #3 *directs* a resolution. These conflict.

**Fix:** Close the decision in the ADR: donated `editors/vscode/` single-sources on **npm + committed `package-lock.json`**; `bun` is dev-only and never gates the build; add a drift-guard script (assert top-level versions in `bun.lock` agree with `package-lock.json`, or simply don't commit `bun.lock` to the donated path). Mark *implementation* deferred to the post-PR-#1288 slice, but the *decision* is locked now (no lingering open question). State that ap-web's npm build is unaffected.

### R-4 (MAJOR — testable acceptance criteria, beyond the one the architect found) — The re-scoped degrade test is MANUAL, label it so
Even after the architect's re-scope ("assert editor renders degraded, chat unaffected"), there is no automatable assertion: forcing a worker failure yields a *degraded-but-rendered* editor (text shows, diff gutters/links absent) which cannot be asserted in vitest (no webview, no DOM-mounted Monaco). The plan's Phase-2 "Acceptance" reads like an automatable check. Phase 3 correctly lists only `buildWorkerSpec` matrix + artifact manifest as automatable.

**Fix:** Move the degrade-path verification explicitly into the **manual checklist** (Phase 3 manual item 6 / `embed-verification.md`): "force a worker failure (rename `editor.worker-*.js` or break the shim URL); confirm (a) chat input + copy/paste unaffected, (b) Monaco route shows fallback panel on a *chunk-load* failure or a degraded editor on a *worker* failure, (c) no uncaught white-screen." Keep Phase-2 "Acceptance" pointing at this manual item; the only automatable Phase-2 assertion is the `buildWorkerSpec` blob/passthrough matrix. This preserves scope honesty (manual vs automated cleanly separated).

### R-5 (MAJOR — gap both Planner and Architect missed) — Blob-URL revocation / worker lifecycle leak
`buildWorkerSpec` returns a `URL.createObjectURL(...)` for every cross-origin worker (plan line 47) and nothing revokes it. Every Monaco mount spawns a worker → a new never-revoked blob URL. With `retainContextWhenHidden: true` (EditorPanelController.ts:63-64) the webview and its workers persist when hidden, so across a long session of diff/code views this leaks blob URLs (and, if Monaco editors aren't disposed on unmount, leaks workers). Neither doc addresses revocation or worker teardown on panel dispose.

**Fix:** In `installWorkerShim`, revoke the object URL immediately after `super(url, opts)` returns (the worker has already fetched the module; the blob URL is no longer needed — standard pattern). Add a `buildWorkerSpec`/shim test asserting the created URL is revoked post-construction. Separately, add one Phase-3 manual note: open/close several Monaco routes and confirm worker count does not grow unbounded in DevTools (verifies Monaco disposes its editor.worker on unmount; if not, file a follow-up — out of scope to fix here but must be observed).

## What is already strong enough to KEEP (do not re-litigate)
- The Phase-0 *gating* discipline (don't build a shim you don't need) — excellent; keep, just reframe per R-1.
- Option A as the no-coordination default + the convergence "A (load) + C-as-net (degrade)" — sound; the seam (wrap `globalThis.Worker` in bootstrap before the first `import("omnigent-embed")`) is verified correct against the same-realm, lazy-Monaco timing (bootstrap.ts:48 vs 113; Monaco constructs workers only on first editor mount).
- The empirical grounding block — accurate; the clobber quote matches monacoSetup.ts:52-57 and csp.ts:91-93 exactly.
- Principle 2 ("the goal is copy/paste, not Monaco") and the lazy-isolation argument — structurally correct; Monaco is off the chat/input path.
- `make verify-pin` proposal (Phase 4 item 3) — keep; it is concrete (compare `git submodule status` SHA to `apweb-pin.json.buildSha`). Note one residual weakness (MINOR, no action required this pass): it proves pin==submodule at verify time, not that the *vendored artifacts* in `media/apweb/` were actually built from that SHA — true provenance needs a rebuild; acceptable for now.
- Artifact-manifest smoke (Phase 3) — keep; assert presence/count, hash-agnostic via globs (`editor.worker-*.js`), matches the 6-vendor + entry set in host.ts:120-128.

## Ralplan Gate Summary
- **Principle/Option Consistency:** FAIL → fixed by R-1 (Principle 1 reword) + R-2. Was the architect's core catch; the reword is necessary but the plan must also state A+D coexistence.
- **Alternatives Depth:** PASS once Option D is added to the options table with its named tradeoff (velocity vs donation-cleanliness, architect tension #1). A/B/C are steelmanned; D was the missing one.
- **Risk/Verification Rigor:** FAIL → R-1 (Phase 0 not decidable as 3-way), R-4 (degrade test not automatable), R-5 (blob/worker lifecycle unaddressed). R1–R6 are otherwise concrete and owned.
- **Scope Honesty:** FAIL → R-3 (lockfile open-question must close; toolchain facts corrected) + R-4 (manual vs automated separation). No silent truncation otherwise.
- **Deliberate Additions:** N/A (SHORT mode; no `--deliberate`). Bounded risk justifies SHORT, but R-5 shows the degrade/lifecycle surface is slightly larger than "bounded by Monaco's laziness" claims — acceptable in SHORT given the mandatory degrade net.

## Open Questions (unscored — for analyst/architect, not blocking this iteration)
- Donated CI sourcing of the embed bundle: `make embed` → `build-apweb` requires the `third_party/omnigent` submodule + `npm run build:embed`; upstream `editors/vscode/` has no such submodule. This is the single biggest *donation* unknown (plan Phase-4 item 2, explicitly future). Not blocking Phases 0-3, but flag it as the donation critical-path blocker, not a side note.
- Does `editor.worker` (edcore.main only, monacoSetup.ts:34) ever spawn a nested worker in this embed config? P0.2 settles R2 severity; if it does, the blob-wrap breaks the nested `import.meta.url`-relative resolution and the degrade net becomes load-bearing rather than belt-and-suspenders.

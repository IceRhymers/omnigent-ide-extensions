# IntelliJ/PyCharm Parity with VS Code — Session Picker + Sidebar

**Status:** `pending approval`
**Branch:** `feat/intellij-parity`
**Mode:** PLANNING ONLY — no source edits, no mutation commands. Do not implement.
**Centerpiece:** the session picker/browser (user priority #1).

---

## Context

The IntelliJ plugin (`intellij/`, Kotlin, IntelliJ Platform Gradle Plugin v2, JCEF tool window) already mirrors the VS Code extension's pure foundation subsystems (discovery, auth, config, API client for agents/create/events/diff) and is conformance-tested against shared JSON vectors in repo-root `docs/conformance/`. The build is GREEN.

What it lacks is everything around **browsing and switching among sessions**. The VS Code extension has a persistent `Sessions` TreeView with filters, 15s visible-only quiet polling, pagination to 200, a settings UI, and a status-bar indicator. IntelliJ has none of that — only the current `sessionId` lives in `SessionStateService`, and there is no `listSessions`/`getSession` in the Kotlin API client and no `Session` data class.

This plan ports that surface in IntelliJ-native idioms while reusing the existing pure-logic + conformance-vector discipline so the new filter/sort/view-model logic is verified against the same vectors as the TypeScript implementation.

### Source-of-truth files (parity targets, VS Code)
- `vscode/src/sessions/filter.ts` — `SessionFilter`, `matchesFilter`, `normalizeWorkspacePath`, `isFilterActive`, `defaultFilter`
- `vscode/src/sessions/treeItem.ts` — `deriveLabel`, `relativeTime`, `statusThemeIconId`, `toItemView`, `sortSessions`
- `vscode/src/sessions/SessionsTreeProvider.ts` — quiet/diff signature, truncation, polling-state lifecycle
- `vscode/src/commands/sessionsTreeCommands.ts` — filter QuickPick UX, current-folder source, clear/toggle
- `vscode/src/api/client.ts` — `Session`, `SessionsPage`, `ListSessionsOptions`, `listSessions` cap-following loop

### Existing IntelliJ seams to reuse
- `SessionStateService.navigateHandler` / `navigate("/c/$id")` — click-to-open is a full `loadURL`; already wired. The picker drives this directly.
- `OmnigentApiClient` (`java.net.http`) + pure `OmnigentPayloads` — extend in the same pure-helper + thin-client style.
- `conformance/Vectors.kt` + `ConformanceTest.kt` `@TestFactory` pattern — add a new vector + factory, mirrored by a new TS test loading the same JSON.
- `OmnigentSettings` `@Service(APP)` PersistentStateComponent (`omnigent.xml`) — extend with a `Configurable` UI, do not change the storage shape.

---

## Work Objectives

1. Give IntelliJ a session picker/browser at parity with VS Code's persistent TreeView (priority #1).
2. Port filters, sort, quiet-signature, pagination, and polling as **pure, conformance-tested Kotlin** mirroring the TS modules byte-for-byte where the contract is observable.
3. Add the supporting `listSessions`/`Session` API surface the picker needs.
4. Close the remaining lower-priority gaps: Settings `Configurable` UI, status-bar widget, keybindings/discoverability.
5. Keep `make build-intellij` GREEN and `make test-intellij` passing at every phase boundary.

---

## Guardrails

### Must Have
- Pure logic (filter/sort/view-model/signature/pagination) lives in stateless Kotlin objects, unit-tested + conformance-tested, with no IntelliJ-platform imports.
- A new shared conformance vector (`docs/conformance/session-filter.json`, and optionally `session-view.json`) consumed by BOTH the Kotlin `ConformanceTest` and a new TS test, proving cross-language parity.
- All JBList/tool-window/model mutations on the EDT; all HTTP/polling off the EDT; in-flight work tied to a `Disposable`.
- Click-to-open reuses `SessionStateService.navigate("/c/$id")`.
- SESSIONS_CAP = 200 and the 15s poll interval as named constants matching VS Code.

### Must NOT Have
- No live SSE streaming of the picker. Parity is 15s polling, not push. (SSE parse helpers exist but stay unused here.)
- No remote bearer auth for JCEF — explicitly deferred (Q2 seam).
- No `renderMode` (iframe|embed) setting — JCEF is in-process Chromium with no such split; it is dead weight in IntelliJ.
- No multi-content-root "current folder" matcher in v1 — pick one single source.
- No change to the `omnigent.xml` persisted storage schema (additive accessors only).
- No architecture redesign of the existing JCEF tool window or actions.

---

## Picker UX Decision (with rationale)

**Decision: a dedicated, separate tool window for the sessions list** — its own `<toolWindow>` registration (id `OmnigentSessions`, anchor left or secondary) hosting `JBList<SessionItemView>` + `ActionToolbar` (refresh / filter / toggle-archived / clear) + `ListSpeedSearch`. The existing `Omnigent` JCEF tool window is left unchanged. Click-to-open still calls `SessionStateService.navigate("/c/$id")` to drive the JCEF browser.

**Why a separate tool window (Option D) is the most faithful parity, not a 2nd Content tab in `Omnigent` (Option A):**
1. **Concurrent visibility matches VS Code.** VS Code shows the sessions list (activity-bar sidebar TreeView) and the conversation (editor-beside panel) **concurrently**. Putting the list in a second `Content` tab of the single `Omnigent` tool window makes the list and the JCEF browser **mutually exclusive** — selecting the Sessions tab hides the very browser it drives. That is *less* faithful. A separate tool window lets the user see the list and the conversation at the same time, exactly like VS Code.
2. **Single-factor visibility gating.** With a dedicated tool window, visible-only polling reduces to a single boolean `ToolWindow.isVisible` (the direct analog of VS Code's `treeView.visible`), instead of the two-factor `ToolWindowManagerListener.stateChanged` + `ContentManagerListener.selectionChanged` a shared tab would require.
3. **Independent `Disposable` lifecycle.** The poll/ticker `Disposable` root is independent of the heavyweight `JBCefBrowser` native disposal, avoiding cross-coupling between background polling and Chromium teardown.
4. **IntelliJ-native ergonomics retained.** `ListSpeedSearch` gives type-to-filter; `ActionToolbar` is the idiomatic home for refresh/filter/clear with `AnAction.update` enablement.

**Option A (2nd Content tab in `Omnigent`)** remains a documented alternative — preferable only in a narrow single-monitor / single-session-focus scenario where right-side width is scarce and the user never needs the list and conversation visible together. Option B (transient popup) is invalidated (see RALPLAN-DR). (Full option comparison with bounded pros/cons in the RALPLAN-DR section below.)

---

## Task Flow

```
Phase 1: Session model + listSessions API (pure parse + thin client; truncated flag)  [no UI]
   -> Phase 2: Pure filter/sort/signature + shared conformance vector (contracts only)   [no UI]
        -> Phase 3: Dedicated Sessions tool window (JBList + toolbar + speed-search) + EDT/off-EDT + click-to-open
             -> Phase 4: Visible-only 15s quiet/diff polling (single-factor isVisible) + pagination wiring
                  -> Phase 5: Settings BoundConfigurable (reactive) + status-bar widget (canonical status) + keybindings
```
Each arrow is a green-build, tests-passing boundary. The conformance contract is locked in Phase 2 before any UI can drift from it; threading risk is quarantined to Phase 3+.

---

## Detailed TODOs

### Phase 1 — Session model + list API (pure-first, no UI)
New/changed files:
- `intellij/.../api/OmnigentApiClient.kt` (or a new `api/Sessions.kt`): add `data class Session` mirroring the TS optional-field shape (`id` required; `agentId`/`agentName`/`status`/`createdAt`/`updatedAt`/`title`/`workspace`/`gitBranch`/`archived` etc. — JSON names `agent_id`, `agent_name`, `created_at`, `updated_at`, `git_branch`), `data class SessionsPage(object, data, firstId, lastId, hasMore)`, `data class ListSessionsOptions(limit?, after?)`.
- Pure parse helpers in `OmnigentPayloads` style: `parseSessionsPage(rawBody): SessionsPage`. Disambiguate absent vs explicit-null vs empty-string on deserialize (kotlinx, `ignoreUnknownKeys = true`, nullable fields default null).
- `OmnigentApiClient`: `listSessionsPage(opts): ApiResponse<SessionsPage>` (`GET /v1/sessions`, set `limit`/`after` only when non-null) and `listSessions(cap = 200): ApiResponse<SessionsResult>`. The cap loop MUST replicate ALL THREE stop conditions of `client.ts:217` EXACTLY, in order — break when `(1) hasMore != true`, OR `(2)` the next cursor (`lastId`) is null/blank, OR `(3) total >= cap`; otherwise set `after = lastId` and continue. Propagate a non-ok page immediately as `ApiResponse(ok=false,...)`. (`getSession` deferred — see Q7; not on the picker critical path.)
- `data class SessionsResult(sessions: List<Session>, truncated: Boolean)` — `listSessions` MUST return `truncated`, NOT discard it (the existing VS Code `listSessions` discards the accumulator's value at `client.ts:220`; do not replicate that).
- **Canonical `truncated` definition (resolves Q2), pinned to `accumulateSessions` semantics (`client.ts:166-181`):** `truncated = lastHasMore && sessions.size >= cap`, where `lastHasMore` is the `has_more` value of the **last page passed to the accumulator** (overwritten each iteration per `client.ts:173`; i.e. `pages.last().hasMore == true`) and `sessions.size` is the accumulated capped total. This is NOT the buggy UI path `size >= CAP` at `SessionsTreeProvider.ts:81`. The Phase 4 "Showing first N" footer uses the accumulated `sessions.size`, NOT the `SESSIONS_CAP` constant.
- **VS Code convergence task (cross-language one-truth):** `listSessions` (`client.ts:201`) currently returns `ApiResponse<Session[]>` and `client.test.ts` pins that `Session[]` shape. Decision: **change `listSessions` to return `ApiResponse<{ sessions: Session[]; truncated: boolean }>`** (surfacing what `accumulateSessions` already computes) rather than adding a sibling function, so there remains one list entry point. Then fix `SessionsTreeProvider.ts:81` to consume that `truncated` instead of recomputing `size >= CAP`. Both languages then compute `truncated` identically and the vector encodes the single definition.
- **Exact VS Code tests to update + behavior delta:**
  - `vscode/src/api/client.test.ts` — pins the current `listSessions` `Session[]` return; update to the `{sessions, truncated}` shape; assert `truncated` for a `hasMore && size==cap` case AND a `!hasMore` case.
  - `vscode/src/sessions/SessionsTreeProvider.test.ts` — asserts the current `truncated = size >= CAP` ("Showing first 200") footer; update to drive `truncated` from the client result. **Boundary delta to encode explicitly:** exactly 200 sessions with `has_more === false` flips from truncated -> NOT-truncated under the canonical definition (old `size >= CAP` marked it truncated; canonical requires `lastHasMore` too), so the footer must NOT appear in that case.

Acceptance criteria:
- `parseSessionsPage` round-trips the documented envelope and missing fields. JUnit5 tests cover absent/null/empty-string disambiguation.
- `listSessions` cap loop stops on exactly the three `client.ts:217` conditions; returns the correct `truncated` per the `accumulateSessions` definition; covered by stub-`HttpClient` tests including `hasMore && size==cap` -> truncated and `!hasMore && size==cap` -> NOT truncated.
- VS Code side: `listSessions` returns `{sessions, truncated}`; provider consumes it (no recompute); `client.test.ts` and `SessionsTreeProvider.test.ts` updated including the 200-with-`has_more:false` non-truncated boundary; TS suite green.
- `make build-intellij` green, `make test-intellij` passing, and the VS Code test suite green. No UI references introduced on the IntelliJ side.

### Phase 2 — Pure filter/sort/view-model + shared conformance vector
New/changed files:
- `intellij/.../sessions/SessionFilter.kt`: `data class SessionFilter(hideArchived, currentFolderOnly, workspacePath?, gitBranch?, agentName?, status?, titleQuery?)`, `defaultFilter()` (`hideArchived=true, currentFolderOnly=false`, rest null), `matchesFilter(s, f)`, `isFilterActive(f)`, `normalizeWorkspacePath(p)`.
- `intellij/.../sessions/SessionView.kt`: `deriveLabel`, `relativeTime(unixSecs, nowMs)`, `statusThemeIconId(status?, archived?)` (mapped to IntelliJ `AllIcons`/icons), `toItemView`, `sortSessions` (desc by `updatedAt ?: 0`, then `id` ascending lexicographic).
- `intellij/.../sessions/SessionSignature.kt`: `computeSignature(state, sessions): String` producing `"state|id:updatedAt:status,..."` in FETCHED order, with absent `updatedAt`/`status` rendered as empty string.
- `docs/conformance/session-filter.json` (ONE new shared vector). Schema follows existing `{description, cases:[{name, input, expected}]}`.
- `intellij/.../conformance/ConformanceTest.kt`: add `@TestFactory sessionFilter()` loading the new vector.
- `vscode/src/sessions/conformance.test.ts` (new): a TS test loading the SAME vector via `vectors.ts` and asserting the existing `matchesFilter`/`isFilterActive`/`sortSessions`/signature produce the vector's `expected`. (This proves the vector is normative for both languages, not just a Kotlin transcription.)

**Shared-vector scope — true cross-language contracts ONLY (resolves Q1):** the vector covers `matchesFilter`, `isFilterActive`, `sortSessions`, `computeSignature`, and `relativeTime` bucket boundaries — these are pure, deterministic, and platform/UI-independent, so a single `expected` is correct everywhere. Two things are **deliberately EXCLUDED** from the shared vector and tested as **language-local, platform-pinned unit tests** instead:
- `statusThemeIconId` / icon mapping — DROP `session-view.json`. IntelliJ must map status to `AllIcons` (it deliberately diverges from VS Code's `ThemeIcon` ids), so conformance-testing it would violate Principle 1. Verify each language's own mapping in its own unit test.
- `normalizeWorkspacePath` path-casing — EXCLUDE from the shared vector because it lowercases only on macOS/Windows (`process.platform`/`SystemInfo`), so a single JSON `expected` is wrong on Linux. Test casing per-language with platform-pinned unit tests (assert the case-sensitive transform always; assert lowercasing only under a darwin/win32-pinned case). The case-*sensitive* workspace-equality branch (after normalization) CAN be in the shared vector using already-normalized inputs.

Parity-critical semantics to encode exactly (call out in the plan to avoid silent drift):
- `archived === true` strictness: only literal true excludes; `false`/null/absent pass.
- Workspace dimension active when `currentFolderOnly || workspacePath != null`; if active but `workspacePath == null` -> exclude; if session `workspace == null` -> exclude; else compare normalized.
- `gitBranch`/`agentName`/`status`: strict equality, case-sensitive, no normalization; a set filter value vs absent session field -> mismatch.
- `titleQuery`: dimension active only if non-null AND `.trim() != ""`; match uses the **untrimmed** query lowercased as a substring of `(title ?: "").lowercase()`. Use `lowercase()` (root locale) to avoid Turkish-I divergence from JS.
- `normalizeWorkspacePath` (language-local test, not shared vector): trim -> `\` to `/` -> strip trailing `/`+ -> lowercase ONLY on macOS/Windows (Linux preserves case).
- Sort tiebreak: lexicographic string compare on `id` (match JS `<`/`>`).
- `relativeTime`: future clamps to 0; buckets just now/`Nm ago`/`Nh ago`/`Nd ago` with `Math.floor` on the unit but `Math.round` on `diffSec`.

Acceptance criteria:
- `session-filter.json` authored; the Kotlin `@TestFactory` AND the new TS test both pass against the same JSON.
- Icon mapping and path-casing covered by language-local platform-pinned unit tests (NOT the shared vector).
- No IntelliJ-platform imports in the `sessions` pure files.
- Build green, tests passing.

### Phase 3 — Dedicated Sessions tool window + threading + click-to-open
New/changed files:
- `intellij/.../sessions/SessionsToolWindowFactory.kt` (NEW, `ToolWindowFactory, DumbAware`): builds the panel content for a SEPARATE tool window (not a tab in `Omnigent`).
- `intellij/.../sessions/SessionsPanel.kt`: builds the `JBList<SessionItemView>` (custom `ColoredListCellRenderer` for label + gray description + status icon, tooltip), speed-search, and an `ActionToolbar`.
  - Speed-search: use `ListSpeedSearch.installOn(list) { item -> item.label }` (the static installer, NOT the deprecated `ListSpeedSearch(...)` constructor); the text extractor returns the DERIVED label, not `toString()`.
  - `ActionToolbar`: after `ActionManager.createActionToolbar(...)`, MUST set `toolbar.targetComponent = list` — without it, `AnAction.update` enablement does not resolve and the toolbar buttons break.
- `intellij/.../sessions/SessionsService.kt` `@Service(PROJECT)`: holds the loaded `List<Session>`, `truncated`, the active `SessionFilter`, last signature, connection/list state; exposes `refresh(quiet: Boolean)` that runs `listSessions` off-EDT and marshals results to EDT; reuses Phase 2 pure logic for filter+sort+signature. The service owns a coroutine scope (see Phase 4) and is its own `Disposable` root.
- `plugin.xml`: register a NEW `<toolWindow id="OmnigentSessions" anchor="left" secondary="false" icon="/icons/omnigent-sessions.svg" factoryClass="ai.omnigent.intellij.sessions.SessionsToolWindowFactory"/>`. **Anchor MUST be `left`, NOT `secondary`/bottom** — a secondary/bottom anchor may not stay concurrently visible with the right-anchored `Omnigent` JCEF window in narrow layouts, which would undermine the Option D concurrency rationale. Use a DISTINCT icon (`omnigent-sessions.svg`, a list/sessions glyph) from the existing `Omnigent` window's `omnigent.svg` for stripe-button discoverability. The existing right-anchored `Omnigent` JCEF tool window is unchanged.
- **Click-to-open handler (double-click / Enter) — exact sequence (MAJOR):** `SessionStateService.navigate()` is `navigateHandler?.invoke(route)` (`SessionStateService.kt:34`) and `navigateHandler` is registered ONLY when the `Omnigent` JCEF window is first opened (`OmnigentToolWindowFactory.kt:94`). A user who opens ONLY the Sessions window and double-clicks would hit a null handler -> nothing opens. The handler MUST, in this order (mirroring the precedent `OpenSessionAction.kt:30-31`):
  1. set `state.sessionId = id` FIRST — the factory reads `state.sessionId` at construction to compute the initial route (`OmnigentToolWindowFactory.kt:82`), so it must be set before the window is created;
  2. `ToolWindowManager.getInstance(project).getToolWindow("Omnigent")?.activate(null)` — opens/focuses the JCEF window, which (if not yet open) constructs it and registers `navigateHandler`;
  3. THEN `state.navigate("/c/$id")`.
  - **No-op feedback (finding 7):** if connection is unresolved (`state.clientOpts == null` / the factory loaded the "no server found" page so `navigateHandler` is the no-op/title-only closure), navigation cannot proceed. Surface a non-blocking notification ("Omnigent server unreachable — open the Omnigent tool window or set Server URL in Settings") via the IDE notification group rather than silently doing nothing.
- New actions (in package `sessions/actions`): `RefreshSessionsAction`, `FilterSessionsAction` (multi-step IntelliJ chooser mirroring the VS Code QuickPick: agent/status/branch/title/currentFolder/archived), `ToggleArchivedAction`, `ClearFiltersAction`.
  - Clear/filter enablement via `AnAction.update` using `isFilterActive` (the IntelliJ equivalent of VS Code's `setContext omnigent.filterActive` — see Q8).
  - Each action that reads `SessionsService` state in `update()` MUST override `getActionUpdateThread()` and return `ActionUpdateThread.BGT` (reads off-EDT) or `EDT` deliberately — required on the 2024.1+ platform or `update()` throws at runtime. The filter state read on BGT MUST be `@Volatile` (mirroring `SessionStateService`'s `@Volatile` house style) so the BGT thread sees the latest value with correct memory visibility.
- `plugin.xml`: register the new actions and a `sessions` action group for the toolbar.

Threading rules (R2):
- HTTP + cap loop on the service coroutine scope (or `executeOnPooledThread`); never on EDT.
- JBList model set, speed-search, content updates on `invokeLater` with correct `ModalityState`.
- Cancel in-flight refresh on tool-window close / project dispose (scope tied to the service `Disposable`).

Current-folder source (R6/Q5): pick ONE — recommended `project.basePath` (fallback `guessProjectDir()?.path`) normalized via `normalizeWorkspacePath`. No multi-root matcher in v1.

**Green boundary for Phase 3 (chosen):** add ONE `BasePlatformTestCase` test that exercises `SessionsService.refresh(quiet)` with a stub list client and asserts the EDT-marshalled result (loaded sessions, filter applied, signature set) — verifying the off-EDT-fetch / EDT-apply seam without driving real Swing painting. The renderer, speed-search, and tool-window wiring remain covered by the documented manual smoke checklist below.
  - **Test-execution wiring (finding 2):** `tasks.test { useJUnitPlatform() }` (`build.gradle.kts:106`) runs the JUnit Platform launcher; `BasePlatformTestCase` is JUnit3/4-based and is discovered ONLY via `junit-vintage-engine`, which is NOT currently declared (only jupiter + `junit:junit:4.13.2` runtime). Sub-task: add `testRuntimeOnly("org.junit.vintage:junit-vintage-engine")` if needed, and VERIFY the platform test is actually COLLECTED AND RUN (e.g. confirm it appears in the test report / fails when deliberately broken) — not merely that the suite is green. This is the one place Phase 3 may need Gradle test-dependency wiring.

Acceptance criteria:
- The new `OmnigentSessions` tool window (anchor `left`, distinct icon) renders the sorted/filtered list; double-click/Enter sets `state.sessionId`, activates the `Omnigent` window, then navigates to `/c/{id}` while the Sessions window stays open (concurrent visibility). Verified including the path where ONLY the Sessions window was open first.
- When connection is unresolved, double-click shows the notification instead of silently no-op'ing.
- `SessionsService.refresh` `BasePlatformTestCase` is OBSERVED to execute (in the test report) and passes (off-EDT fetch, EDT apply, filter+signature correct); vintage engine wired if required.
- Filter chooser sets the active `SessionFilter`; list updates; clear resets to default; clear/filter actions enable/disable correctly.
- Speed-search filters by typed text. Empty/loading/error/unauthorized/no-match/truncated states render parity messages ("Loading…", "Omnigent server unreachable", "Not authorized (401/403) — check your token", "No sessions", "No sessions match the active filter", "Showing first N").
- No EDT-threading exceptions during the manual smoke. Smoke checklist MUST include: (a) open project -> open Sessions tool window -> refresh -> filter -> clear -> double-click navigates JCEF concurrently; AND (b) open ONLY the Sessions window (never opening `Omnigent` first) -> double-click -> the `Omnigent` window opens to `/c/{id}`.
- Build green, tests passing.

### Phase 4 — Visible-only 15s quiet/diff polling + pagination wiring
New/changed files:
- `SessionsService.kt`: a **coroutine ticker on the service scope** firing every `SESSIONS_POLL_INTERVAL_MS = 15_000` (preferred over `Alarm` — matches the existing `executeOnPooledThread`/`invokeLater` house style and gives structured cancellation via the service `Disposable`). If `Alarm` is used instead, it MUST take the service as parent `Disposable` and re-`addRequest` each tick. On tick, only refresh `quiet=true` if the Sessions tool window is currently visible. Skip the model update if `computeSignature` equals the last signature (diff-only, no flash). On becoming-visible, do a non-quiet refresh.
- Visibility primitive (R3/Q3 — single factor, enabled by the dedicated tool window): gate polling on `ToolWindow.isVisible` for the `OmnigentSessions` window (the direct analog of VS Code's `treeView.visible`). Subscribe to `ToolWindowManagerListener.stateChanged` only to fire the non-quiet refresh on the hidden->visible transition. No `ContentManagerListener.selectionChanged` two-factor logic needed (that complexity was a cost of the rejected single-shared-tool-window design).
- Truncation footer: append a non-selectable "Showing first N" row/banner when `truncated`. Uses the canonical `truncated` from `SessionsResult` (Phase 1: `lastHasMore && size >= cap` per `accumulateSessions`), NOT a UI-side `size >= cap` recompute. **N is the accumulated `sessions.size`, NOT the `SESSIONS_CAP` constant.**

Acceptance criteria:
- Poll fires only while the `OmnigentSessions` tool window is visible (`isVisible == true`); stops when hidden; resumes with a non-quiet refresh on show.
- Unchanged data across a poll produces NO visible list change (signature equality verified by a unit test on `computeSignature`).
- Pagination accumulates up to 200; truncated banner appears when capped, driven by the canonical `truncated` flag.
- Build green, tests passing.

### Phase 5 — Settings BoundConfigurable + status-bar widget + keybindings
New/changed files:
- `intellij/.../config/OmnigentConfigurable.kt`: a `BoundConfigurable` using the Kotlin UI DSL (`panel { ... }`) under Settings -> Tools -> Omnigent editing `serverUrl`, `token`, `defaultAgentId` (+ `defaultAgentName` only if the picker needs it — see Q6). Use `BoundConfigurable` (NOT plain `Configurable`) so `isModified`/`apply`/`reset` are wired automatically to the bound properties. On apply, re-resolve connection and trigger a picker refresh (R7 reactive concern). `plugin.xml`: register `<applicationConfigurable>` (settings are APP-level).
- `intellij/.../statusbar/OmnigentStatusBarWidgetFactory.kt` + widget: **the single canonical status surface** (the VS Code parity surface is its status-bar item — `vscode/src/commands/openSession.ts:113`). Connection state + host icon + current session id tooltip; subscribes to `SessionStateService.statusListener`. `plugin.xml`: register `<statusBarWidgetFactory>`.
- **Demote the IntelliJ-invented tool-window-title status (single-slot constraint):** `SessionStateService.statusListener` is a SINGLE-SLOT nullable field (`SessionStateService.kt:31`) — `updateStatus` invokes exactly one registered callback; a second registrant would silently CLOBBER the first. Demoting the JCEF tool window's title-status (it currently registers `statusListener` to refresh its title) is therefore what frees the slot for the widget to be the sole registrant. State this explicitly so no later work wires a second `statusListener` without first generalizing the field to a listener list. Leave the tool-window title static.
- `plugin.xml`: add `<keyboard-shortcut>` defaults for the high-value actions (Open/Switch Session, Refresh Sessions) for discoverability.

Acceptance criteria:
- Settings panel (`BoundConfigurable`) reads/writes `omnigent.xml` fields (no storage-schema change); `isModified`/`apply`/`reset` behave correctly; changing serverUrl/token re-resolves connection and refreshes the picker without IDE restart.
- Status-bar widget is the only status surface and updates on `statusListener` changes; tool-window title no longer reflects status.
- Keybindings invoke the actions; actions remain discoverable in Tools menu.
- `renderMode` explicitly excluded. Build green, tests passing.

---

## Test Strategy
- **Cross-language conformance (the parity gate):** ONE new `docs/conformance/session-filter.json` covering `matchesFilter`/`isFilterActive`/`sortSessions`/`computeSignature`/`relativeTime` bucket boundaries, run by the Kotlin `@TestFactory` AND a new TS test loading the same file. (No `session-view.json` — icon mapping is excluded by design.)
- **Language-local unit tests (deliberately NOT shared):** `statusThemeIconId`/`AllIcons` mapping (per language) and `normalizeWorkspacePath` path-casing (platform-pinned: case-sensitive transform always; lowercasing under a darwin/win32-pinned case).
- **Pure-logic unit tests (JUnit5):** `parseSessionsPage` (absent/null/empty disambiguation), `listSessions` cap loop + `truncated` flag (stub `HttpClient`, both truncated and non-truncated cases), `computeSignature` diff-equality and absent-field rendering.
- **Platform test (Phase 3 green boundary):** one `BasePlatformTestCase` for `SessionsService.refresh(quiet)` verifying off-EDT fetch -> EDT apply, filter applied, signature set.
- **UI smoke (manual, documented checklist):** open project -> open `OmnigentSessions` tool window -> refresh -> filter -> clear -> double-click navigates JCEF (Sessions window stays visible) -> hide/show toggles polling. No EDT exceptions.
- **VS Code regression:** the Phase 1 `truncated` convergence fix keeps the TS suite green.
- **Regression:** full `make build-intellij` + `make test-intellij` green at each phase boundary; existing 6 conformance vectors unaffected.

---

## Success Criteria (overall)
- IntelliJ has a dedicated Sessions tool window at behavioral parity with the VS Code sidebar TreeView, visible CONCURRENTLY with the JCEF conversation: sorted list, filters, 15s visible-only quiet polling (single-factor `isVisible`), pagination to 200 with canonical `truncated`, click-to-open via `navigateHandler`.
- Filter/sort/signature logic is conformance-tested against a shared vector that BOTH plugins execute; icon mapping and path-casing are language-local platform-pinned tests by design.
- VS Code and IntelliJ converge on one `truncated` definition (VS Code fixed in Phase 1).
- Settings `BoundConfigurable`, a single canonical status-bar widget (tool-window-title status removed), and keybindings close the lower-priority gaps.
- Build GREEN, tests passing, no new tracked registry URLs, persisted-settings schema unchanged.

---

# RALPLAN-DR Summary

**Mode: SHORT.** (No `--deliberate` / high-risk signal given. Pre-mortem and expanded test plan omitted; flag if you want DELIBERATE.)

## Principles
1. **Pure logic first, conformance-tested.** Observable contracts (filter/sort/signature/pagination) are stateless Kotlin verified against a shared vector, mirroring the TS modules.
2. **Reuse seams, don't redesign.** Build on `navigateHandler`, `OmnigentApiClient`/`OmnigentPayloads`, `OmnigentSettings`, and the `Vectors`/`@TestFactory` harness.
3. **Native idioms over literal transcription.** TreeView -> dedicated tool-window `JBList` + `ActionToolbar` + `ListSpeedSearch`; `setContext` -> `AnAction.update`; `setInterval` -> coroutine ticker on a service scope with EDT discipline.
4. **Green at every boundary.** Each phase compiles and tests pass; the parity contract locks before UI exists.
5. **Tight scope.** No SSE push, no remote-bearer-for-JCEF, no `renderMode`, no multi-root matcher in v1.

## Decision Drivers (top 3)
1. **Parity fidelity to *concurrently visible* list + conversation with *persistent* filter + background refresh** — VS Code shows the sidebar TreeView and the editor conversation panel at the same time; the IntelliJ design must allow the same, which a transient popup (no steady state) and a single shared tool window (mutually exclusive tabs) both fail.
2. **Cross-language conformance correctness** — platform/locale/null semantics must not silently diverge (esp. path-casing, `lowercase` locale, `archived===true`); shared vector scoped to truly portable contracts only.
3. **EDT safety + single-factor visible-only polling reliability** in IntelliJ's multi-threaded, listener-based model vs VS Code's single-threaded `treeView.visible`.

## Viable Options for the picker UI (>= 2)

### Option D — Dedicated, separate tool window for the sessions list (own `<toolWindow>`, left/secondary anchor)  **[CHOSEN]**
- Pros: most faithful parity — the sessions list and the JCEF conversation are visible CONCURRENTLY (mirrors VS Code's sidebar + editor panel), unlike a shared single tool window where the tabs are mutually exclusive; visible-only polling collapses to a single boolean `ToolWindow.isVisible` (direct analog of `treeView.visible`); poll `Disposable` is independent of the heavyweight `JBCefBrowser` native disposal; existing `Omnigent` JCEF tool window untouched; click-to-open still reuses `navigateHandler`.
- Cons: a second tool window consumes a stripe button / screen edge; slightly more registration than reusing the existing window.

### Option A — Persistent panel as a SECOND Content tab in the existing `Omnigent` tool window
- Pros: reuses the existing tool window; one stripe button.
- Cons: the Sessions tab and the JCEF browser become MUTUALLY EXCLUSIVE — selecting Sessions HIDES the browser it drives, which is *less* faithful to VS Code's concurrent sidebar+panel; visible-only polling needs two-factor `ToolWindowManagerListener.stateChanged` + `ContentManagerListener.selectionChanged`; poll lifecycle entangles with `JBCefBrowser` disposal. Retained as the better choice ONLY for narrow single-monitor / single-session-focus use where right-side width is scarce.

### Option B — Transient `JBPopup`/`ListPopup` "Switch Session" picker (Goto-style)
- Pros: most IntelliJ-idiomatic *picker* gesture; minimal real-estate; fast keyboard-driven switch; least UI code.
- Cons: cannot host persistent/visible filter state; collapses on focus loss so no watchable 15s background refresh; breaks the persistent-list parity contract; awkward home for refresh/clear/toggle-archived. **Invalidated** as the primary surface.

### Option C — Both (dedicated tool window + a thin transient popup as a quick-switch shortcut)
- Pros: maximal ergonomics — persistent parity (D) AND a quick keyboard switch.
- Cons: roughly doubles the picker surface and maintenance; the popup is redundant for parity in v1; risks scope creep. Defer the popup to a stretch follow-up on top of D.

**Decision: D** (with C's popup as an optional later add). A is the documented fallback for width-scarce setups. B is invalidated because it cannot satisfy the persistent-filter + concurrently-visible + background-refresh parity contract, which is the core of what the user is asking to match.

---

## Open Questions (to resolve before/early in execution)
See `.omc/plans/open-questions.md`. Headlines:
- **Q1 [RESOLVED]** Path-casing is EXCLUDED from the shared `session-filter.json` and tested as language-local platform-pinned unit tests; the shared vector covers only portable contracts (`matchesFilter`/`isFilterActive`/`sortSessions`/`computeSignature`/`relativeTime`). Icon mapping (`statusThemeIconId`) is also language-local, not shared.
- **Q2 [RESOLVED]** Canonical `truncated` = `lastHasMore && size >= cap` per `accumulateSessions` (`client.ts:166-181`; `lastHasMore` = `has_more` of the last page passed to the accumulator), not the buggy `size >= CAP` UI path. Kotlin `listSessions` returns it; VS Code `listSessions` return type changes to `{sessions, truncated}` in Phase 1 and the provider consumes it. Boundary: 200 sessions with `has_more:false` is NOT truncated.
- **Q3** Chosen visible-only polling primitive: single-factor `ToolWindow.isVisible` on the dedicated `OmnigentSessions` window + `ToolWindowManagerListener.stateChanged` for resume-on-show. (Enabled by the Option D decision.)
- **Q5** IntelliJ "current folder" source (recommended `basePath`, fallback `guessProjectDir`); no multi-root matcher in v1.
- **Q6** Are `defaultAgentName` / `renderMode` in scope? `renderMode` recommended OUT (JCEF has no iframe/embed split); `defaultAgentName` only if the picker needs it.
- **Q7** Is `getSession` needed for the picker, or only `listSessions` (recommend defer).
- **Q8** IntelliJ equivalent of `setContext omnigent.filterActive` for action enablement: `AnAction.update` reading `isFilterActive`, AND each such action MUST override `getActionUpdateThread()` (BGT vs EDT) on the 2024.1+ platform or `update()` throws at runtime; the BGT-read filter state MUST be `@Volatile`.

---

## Revision Changelog (Architect review incorporated, 2026-06-24)
1. **Picker host re-decided to Option D (dedicated separate tool window).** Added Option D and made it CHOSEN; demoted the previous Option A (2nd Content tab) to a width-scarce fallback; kept B invalidated. Rationale added: concurrent list+conversation visibility (A makes them mutually exclusive), single-factor `isVisible` polling, and a poll `Disposable` independent of `JBCefBrowser`. Updated the Picker UX Decision section, Task Flow, Decision Drivers, and the Options list.
2. **`truncated` adjudicated to one canonical definition** (`lastConsumedPage.hasMore && size >= cap`, per `client.ts:180`). Phase 1 now has Kotlin `listSessions` RETURN `truncated` via `SessionsResult`, plus a VS Code convergence task (thread documented `truncated` through `listSessions` and consume it in the provider instead of recomputing `size >= CAP`). Q2 resolved.
3. **Shared conformance vector scoped to portable contracts only.** Dropped `session-view.json`; `statusThemeIconId` icon mapping and `normalizeWorkspacePath` path-casing moved to language-local, platform-pinned unit tests. Shared `session-filter.json` now covers `matchesFilter`/`isFilterActive`/`sortSessions`/`computeSignature`/`relativeTime` only. Q1 resolved.
4. **Phase 3 green boundary hardened:** added one `BasePlatformTestCase` for `SessionsService.refresh(quiet)` EDT marshalling; the rest stays a documented manual smoke checklist (stated explicitly).
5. **Pre-baked IntelliJ Platform API specifics** into Phase 3/5 TODOs: `ListSpeedSearch.installOn(list, textExtractor)` (label extractor, not `toString()`); mandatory `ActionToolbar.targetComponent`; `getActionUpdateThread()` override on state-reading actions (folded into Q8); `BoundConfigurable` (Kotlin UI DSL) over plain `Configurable`; coroutine ticker on a service scope over `Alarm` (with the Alarm parent-`Disposable`/re-`addRequest` caveat).
6. **Status surfaces consolidated:** status-bar widget is the single canonical status surface; Phase 5 now removes the IntelliJ-invented tool-window-title status so there is exactly one `statusListener` source of truth.

Phase 1->2 ordering and the pure-logic-first + conformance discipline are unchanged. Re-saved `pending approval`.

## Revision Changelog (Critic ITERATE incorporated, 2026-06-24)
Critic PASSed architecture/options/conformance-scoping; these close the remaining specification gaps.
1. **Click-to-open activation sequence specified (MAJOR).** Phase 3 handler now: set `state.sessionId` FIRST (factory reads it at construction, `OmnigentToolWindowFactory.kt:82`) -> activate `Omnigent` tool window (registers `navigateHandler`, which is null until the JCEF window opens — `SessionStateService.kt:34`, `OmnigentToolWindowFactory.kt:94`; precedent `OpenSessionAction.kt:30-31`) -> `navigate("/c/$id")`. Smoke checklist gains the "open ONLY Sessions window first, then double-click" case. Acceptance updated.
2. **Phase 3 platform-test execution made a verified criterion.** `useJUnitPlatform()` (`build.gradle.kts:106`) won't discover JUnit3/4 `BasePlatformTestCase` without `junit-vintage-engine` (not currently declared). Added sub-task to add `testRuntimeOnly("org.junit.vintage:junit-vintage-engine")` if needed and OBSERVE the test actually executes (test report), not just a green suite.
3. **Named the exact VS Code tests + behavior delta for the `truncated` fix.** `client.test.ts` (pins `Session[]` return — now `{sessions, truncated}`) and `SessionsTreeProvider.test.ts` (pins `size >= CAP` footer). Documented the boundary delta: 200 sessions with `has_more:false` flips truncated->NOT-truncated (footer must not appear). Chose changing `listSessions`' return type over a sibling function.
4. **Pinned Kotlin `truncated` to exact `accumulateSessions` semantics** (`client.ts:166-181`): `lastHasMore` = `has_more` of the LAST page passed to the accumulator AND `size >= cap`; replaced the looser "lastConsumedPage.hasMore" wording. Footer N = accumulated `sessions.size`, not `SESSIONS_CAP`.
5. **`statusListener` single-slot constraint stated (Phase 5).** `SessionStateService.kt:31` is one nullable slot; a second registrant clobbers the first. Demoting the title-status frees the slot for the widget; flagged that adding any second listener requires generalizing the field to a list first.
6. **Sessions tool window anchor resolved to `left`** (not secondary/bottom, to guarantee concurrent visibility with the right-anchored JCEF window) + a DISTINCT `omnigent-sessions.svg` icon for discoverability.
7. **No-op feedback specified:** when connection is unresolved, double-click shows an IDE notification (server-unreachable guidance) instead of silently doing nothing.
8. **BGT memory-visibility note (Q8):** filter state read in `update()` on BGT must be `@Volatile`, mirroring `SessionStateService` house style.
9. **Three exact `listSessions` stop conditions pinned** to `client.ts:217`: `hasMore != true`, null/blank next cursor, `total >= cap`.

Re-saved `pending approval`.

# Ralplan Plan: Native Session-List TreeView for the Omnigent VS Code Extension

**Status:** PENDING APPROVAL (consensus-approved; not yet authorized for execution)
**Consensus:** Planner → Architect → Critic, 2 iterations. Critic verdict: **APPROVE**. Architect: **APPROVABLE**.
**Scope:** VS Code extension only (`vscode/`). IntelliJ deferred.

---

## 1. Goal

Replace the activity-bar full-app webview (`omnigent.panel`) with a native VS Code `TreeView` (`omnigent.sessions`) listing the user's Omnigent sessions (`GET /v1/sessions`). Clicking a session opens/reuses the editor-beside `WebviewPanel` and navigates it to `/c/<id>` through a single `EditorPanelController` shared by all entry points. Filters are opt-in, in-memory, AND-combined, via native VS Code idioms. The now-orphaned sidebar-app config and dead code are retired in the same change.

## 2. Non-Goals

- No create-session from the tree (use existing `omnigent.openSession`).
- No archive / delete / rename actions.
- No badges, comment counts, copy-link, or context-token gauges in v1 (`labels` data present; deferred).
- No SSE / live push for the list — manual + focus + light visible-only poll.
- No filter persistence — resets each reload.
- IntelliJ — out of scope.
- No server changes.

## 3. Constraints

- Pure, injected-`fetchImpl`, unit-tested core in `client.ts` and `sessions/*`; thin VS Code adapters.
- Token never logged (`redact`); travels only via existing client/postMessage paths.
- `engines.vscode ^1.90.0` supports `TreeView`, `TreeDataProvider`, `ThemeIcon`, `when`-menus, `setContext`.

---

## 4. Pinned API Types (from live `GET /v1/sessions` capture)

Envelope: OpenAI-style cursor pagination — `{ object:"list", data:[…], first_id, last_id, has_more }`.

```ts
export interface Session {
  id: string;                    // "conv_..."
  agent_id?: string;             // "ag_..."
  agent_name?: string;           // "claude-native-ui"
  status?: string;               // open string enum: "running" | "idle" | ...
  created_at?: number;           // unix SECONDS
  updated_at?: number;           // unix SECONDS
  title?: string;                // OPTIONAL — absent on some sessions
  labels?: Record<string, string>;
  runner_id?: string;
  host_id?: string;
  permission_level?: number;
  owner?: string;
  external_session_id?: string;
  pending_elicitations_count?: number;
  workspace?: string;            // abs path, OPTIONAL
  git_branch?: string;           // OPTIONAL
  archived?: boolean;            // BOOLEAN (confirmed — not a status value)
  comments_count?: number;
  [key: string]: unknown;
}
export interface SessionsPage {
  object: "list";
  data: Session[];
  first_id?: string | null;
  last_id?: string | null;
  has_more?: boolean;
}
```

**Residual unknown (non-blocking):** exact pagination query-param names (`limit`/`after`?). Step 0 probes the live server once before coding `listSessionsPage`; `accumulateSessions` is designed against the `has_more` + `last_id` cursor contract regardless. Step 0 must include a "param scheme unknown" fallback branch.

---

## 5. File-by-File Change List

### 5.0 `vscode/src/api/client.ts`
- Fix stale header comment (`GET /api/agents` → `/v1/agents`); add `GET /v1/sessions` to the surface list.
- Replace loose `Session` with the **pinned** interface above; add `SessionsPage`.
- Add:
  ```ts
  export interface ListSessionsOptions { limit?: number; after?: string; }
  export function accumulateSessions(pages: SessionsPage[], cap: number):
    { sessions: Session[]; truncated: boolean };          // truncated = has_more still true at cap
  export async function listSessionsPage(opts, page?): Promise<ApiResponse<SessionsPage>>;
  export async function listSessions(opts, cap = 200): Promise<ApiResponse<Session[]>>;
  ```
- `listSessions` surfaces `mapHttpStatus` outcomes so 401/403 propagate as the unauthorized state.

### 5.1 NEW `vscode/src/sessions/filter.ts`
`SessionFilter { hideArchived(default true), currentFolderOnly(default false), workspacePath?, gitBranch?, agentName?, status?, titleQuery? }`; `defaultFilter()`, `matchesFilter` (AND-combined; `hideArchived` drops `archived===true`), `normalizeWorkspacePath` (trim trailing slash, normalize sep, OS-aware case), `isFilterActive`.

### 5.2 NEW `vscode/src/sessions/treeItem.ts`
`SessionItemView`; `deriveLabel` (title || derived-from-id), `relativeTime` (unix **seconds**→ms internally), `statusThemeIconId` (running→play-circle, idle→circle-outline, error→error, archived→archive), `toItemView`, `sortSessions` (updated_at desc, id tiebreak).

### 5.3 NEW `vscode/src/panel/EditorPanelController.ts` — SOLE owner of the editor panel
Owns the editor `WebviewPanel` singleton **and** resolved `{target, token, route}` (relocated from `registerOpenPanel`'s closure and the deleted `OmnigentViewProvider`).
- `setResolved(target, token)` — replaces `provider.init`; called from `extension.ts` after server/auth resolves. **MUST re-render/re-navigate an already-open panel** (C1) so a panel opened during the async auth window doesn't stick on a "Resolving…" placeholder.
- `ensure()` — create-or-reveal beside; render via `renderInto` at the controller's current route; **must NOT reset an already-navigated route to `/` on reveal** (C2).
- `navigate(route)` — set route; ensure(); iframe path re-renders routed URL, embed path posts `{type:"omnigent/navigate", route}` to **this** panel's webview. Sole mutator of `route`.
- `isOpen()`, `dispose()` — `dispose()` calls `panel.dispose()` + nulls the ref; `onDidDispose` must not double-fire into a disposed controller (C3).

### 5.4 NEW `vscode/src/sessions/SessionsTreeProvider.ts` — thin adapter
`TreeDataProvider`; states `loading | ready | error | no-server | unauthorized`; in-memory `filter`; `refresh()` (clientOpts undefined → no-server; 401/403 → unauthorized; else fetch); `setFilter` mutates + `setContext omnigent.filterActive` + refresh; `getChildren` pure filter+sort or a single message node per state/no-match. Truncation node only when `accumulateSessions` reports `truncated===true`, labeled "Showing first N" (N = actual fetched count).

### 5.5 `vscode/src/commands/openPanel.ts`
Remove module-local `editorPanel` singleton + `renderEditorPanel` closure; delegate to `EditorPanelController`. **Delete** left/right branches + `omnigent.panel.focus` (line ~75). `omnigent.open` body = `controller.ensure()`; command kept.

### 5.6 `vscode/src/commands/openSession.ts`
Remove `omnigent.panel.focus` (line ~127); replace `provider.postMessage` navigate (line ~159) with `controller.navigate(`/c/${id}`)` (fixes latent sidebar-post bug). Drop `OmnigentViewProvider` param; accept controller.

### 5.7 NEW `vscode/src/commands/sessionsTreeCommands.ts`
`registerOpenSessionFromTree` (handler = `controller.navigate(`/c/${id}`)`; `sessionState.sessionId = id`); `registerSessionsTreeCommands` (refresh / filter / toggleArchived / filterCurrentFolder / clearFilters).

### 5.8 DELETE `vscode/src/panel/OmnigentViewProvider.ts` + `VIEW_ID`
Remove file + all imports/usages in `extension.ts`; resolved-target ownership moved to `EditorPanelController`.

### 5.9 `vscode/src/extension.ts`
Instantiate `EditorPanelController`; remove `registerWebviewViewProvider`; `createTreeView("omnigent.sessions", {…})`; pass controller to `registerOpenPanel`/`registerOpenSession`/`registerOpenSessionFromTree`; after auth → `controller.setResolved(target, token)` + `sessionsProvider.refresh()`; `onDidChangeVisibility → refresh`; 15s poll **only while `treeView.visible`**, fires `onDidChangeTreeData` **only on a data diff** (hash of sorted ids+updated_at+status); `deactivate()` clears poll interval + `controller.dispose()` (null-guarded) + closes output.

### 5.10 `vscode/package.json`
`views` → `{ id:"omnigent.sessions", name:"Sessions", type:"tree" }`; **DELETE** `omnigent.panelLocation` config; add commands; `view/title` menus re-gated to `view == omnigent.sessions` (refresh@1, filter@2, openSession@3, clearFilters when `omnigent.filterActive`, toggleArchived, filterCurrentFolder); `editor/title` **keeps** `omnigent.open`; `openSessionFromTree` palette `when:false`.

### 5.11 `vscode/src/config/index.ts` + `vscodeSettings.ts`
Remove `PanelLocation` type (index.ts:17) + `Settings.panelLocation` field (index.ts:38) + the `panelLocation` read (vscodeSettings.ts:17) **and the `PanelLocation` import (vscodeSettings.ts:7)** — both lines, else `tsc --noEmit` breaks.

---

## 6. Acceptance Criteria

1. Activity-bar container shows a native tree "Sessions"; no webview view registered for `omnigent-container`.
2. Reachable local server → lists `GET /v1/sessions` sorted by `updated_at` desc, archived hidden by default.
3. Each item: label (title or derived), description (agent · relative time), status `ThemeIcon`, tooltip (workspace/branch/status/created/updated).
4. Click opens/reveals the editor panel, navigates to `/c/<id>`; `sessionState.sessionId === id`.
5. `Refresh` re-fetches; view refreshes on becoming visible.
6. Filter commands narrow AND-combined; `Clear Filters` restores default; `omnigent.filterActive` toggles `Clear Filters` visibility.
7. Filter state resets after reload.
8. Distinct legible states: no-server, unauthorized (401/403), loading, empty, no-match. First reveal before `activate()` resolves → loading/no-server (no crash).
9. Pagination accumulates to the cap; truncation hint only when `has_more` still true at cap, labeled with actual fetched count N.
10. No regressions: `openSession`, `sendSelection`, `viewDiffs`, `applyDiffs`, `omnigent.open` still function; type-check + existing tests pass.
11. **(gate)** `grep -rn "createWebviewPanel" vscode/src` → exactly 1 hit, in `EditorPanelController.ts`; no `editorPanel` var outside it.
12. **(gate)** `grep -rn "omnigent.panel.focus" vscode/src` → 0; `grep -rni "panelLocation" vscode/` → 0.
13. **(gate)** `grep -rn "OmnigentViewProvider\|VIEW_ID" vscode/src` → 0; `grep -rn "omnigent.panel" vscode/` → 0; `view/title` references `omnigent.sessions`.
14. **(gate)** Reconciliation test: after `openSession` and `openSessionFromTree`, `controller.navigate("/c/<id>")` is called AND the **editor panel's** `webview.postMessage` receives `{type:"omnigent/navigate", route:"/c/<id>"}` (embed path) — not the old sidebar `provider.postMessage` path.
15. **(gate)** Open panel before `setResolved` → panel updates after `setResolved` (re-render-if-open test).

---

## 7. Test Plan

**Pure unit (vitest, injected data):** `accumulateSessions` (single/multi-page cursor, cap truncation true/false); `listSessions` w/ stub fetch (200 chain, 401/403→unauthorized, network err→status:0); pinned `Session` parsing (optional fields, archived boolean). `matchesFilter` per dimension + AND; `hideArchived`; `normalizeWorkspacePath`; `isFilterActive`. `deriveLabel`, `relativeTime` (seconds→ms boundaries), `statusThemeIconId`, `toItemView`, `sortSessions`.

**Thin-adapter / reconciliation:** `SessionsTreeProvider.getChildren` node arrays for every state + no-match + truncation; reconciliation test (AC14); re-render-if-open test (AC15); integration test GET `/v1/sessions` against live local server (also the Step-0 param-probe regression anchor).

---

## 8. Risks

| # | Risk | Status |
|---|---|---|
| R1 | Lost in-sidebar app; `panelLocation` removed | Accepted (locked). `omnigent.open` (editor-title + palette) remains the app entry point; document in README/CHANGELOG. |
| R2 | Large session lists | Cap (200), truncation hint, diff-only poll, default hide-archived. |
| R3 | Workspace path matching across worktrees/symlinks/case | `normalizeWorkspacePath`; current-folder filter opt-in so a mismatch never silently hides all; document caveat. |
| **R4** | **Remote/hosted `GET /v1/sessions` parity UNVERIFIED** | **The one parked risk.** Non-ok → error/unauthorized state. **Follow-up gate: verify remote before GA**, incl. a 404-on-remote fallback presentation reusing the error/unauthorized node. |
| R5 | Navigation reconciliation regression | Resolved by design (controller sole owner; AC11/AC14). |
| R6 | Activation race / no token at first reveal | loading/no-server/unauthorized states cover `clientOpts === undefined`; refresh retries on focus + after `setResolved`. |

---

## 9. Task Flow (executor steps)

0. Probe live server once for `GET /v1/sessions` pagination param names (fallback branch if unknown).
1. Client layer: fix comment; pin types; add `accumulateSessions`/`listSessionsPage`/`listSessions` (+401/403) + unit tests.
2. Pure session modules: `filter.ts` + `treeItem.ts` + tests.
3. Controller + dead-code retirement: `EditorPanelController` (sole owner; resolved target/token/route; re-render-if-open); refactor `openPanel.ts` + `openSession.ts`; delete `OmnigentViewProvider`/`VIEW_ID`; remove `PanelLocation` (both lines in vscodeSettings.ts); reconciliation + re-render-if-open tests.
4. Tree provider + commands: `SessionsTreeProvider` (all states + truncation); `sessionsTreeCommands.ts`; `setContext omnigent.filterActive`.
5. Manifest + wiring: package.json (views→tree, delete panelLocation, commands, menus, keep editor-title open, palette when:false); extension.ts (createTreeView, controller, setResolved, focus refresh, visible-only diff poll, deactivate teardown).
6. Verify: `npm run type-check` + `npm test`; run AC11–AC15 greps; manual walkthrough of §6; README/CHANGELOG note R1 + R4.

---

## 10. ADR

- **Decision:** Replace `omnigent.panel` webview with a native `omnigent.sessions` `TreeView`; full app renders only in the editor-beside `WebviewPanel`, navigated through a single `EditorPanelController` shared by `omnigent.open`, `openSession`, `openSessionFromTree`. Controller is sole owner of the editor-panel reference and resolved `{target, token, route}`. Filters opt-in, AND-combined, in-memory (title-bar toggles + `Filter…` QuickPick).
- **Drivers:** native UX clarity; test/maintainability parity; low blast radius with no orphaned dead paths.
- **Alternatives considered:** keep webview + add second tree view (rejected — cramped, duplicate, contradicts locked decision); single-QuickPick or per-dimension input-box filters (viable but less discoverable / non-idiomatic).
- **Why chosen:** session list is a canonical tree; editor pane is the right home for the app; a single navigation owner eliminates the latent sidebar-post bug.
- **Consequences:** in-sidebar app + `panelLocation` removed (documented); `OmnigentViewProvider` deleted; target/token/route ownership moved to controller; `deactivate` now tears down poll timer + controller.
- **Parked:** R4 remote-list parity — gated by a "verify remote before GA" follow-up.
- **Follow-ups:** verify remote `GET /v1/sessions` (+404 fallback); confirm pagination param spelling (Step 0); future per-item actions hang off reserved `contextValue == "omnigentSession"`.

---

## 11. Open Questions for the user (do not block implementation)

- **R4 remote parity:** confirm `GET /v1/sessions` shape on hosted/remote servers before GA.
- **Default cap (200):** acceptable for v1, or prefer server-side workspace filtering for power users?

/**
 * A9 — Native command: changed files + view/apply diffs.
 *
 * Pure logic (gating, snapshot, partial-apply rollback) is in the top half.
 * The thin vscode parts (diff viewer, file write, SSE subscription wiring) are
 * in the bottom half inside registerDiffsCommand().
 *
 * Key rules from the plan (resolved v2):
 *  - BOTH local AND remote sessions can VIEW diffs (server proxies to the runner).
 *  - APPLY (write after-content to workspace) is ONLY enabled when hostType === 'local'.
 *  - SNAPSHOT each target file BEFORE writing so revert is truthful (PM6 residual).
 *  - PARTIAL-APPLY rollback: on failure mid-batch, report which files were applied
 *    and offer revert of the applied subset from the snapshots.
 */
import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import {
  listChangedFiles,
  fetchDiff,
  ClientOptions,
  ChangedFile,
  DiffResult,
  openSseStream,
} from "../api/client";
import type { HostType } from "../config";
import type { SessionState } from "./sessionState";

export const VIEW_DIFFS_COMMAND = "omnigent.viewDiffs";
export const APPLY_DIFFS_COMMAND = "omnigent.applyDiffs";

// ── Pure / unit-testable logic ─────────────────────────────────────────────────

/** Pure: is apply allowed for this host type? */
export function isApplyAllowed(hostType: HostType): boolean {
  return hostType === "local";
}

/** Pure: check whether an SSE event signals changed files invalidation. */
export function isChangedFilesEvent(event: { event?: string; data: string }): boolean {
  return event.event === "session.changed_files.invalidated";
}

export interface ApplyResult {
  applied: string[];
  failed: string[];
  snapshots: Map<string, string>;
}

/**
 * Pure: build the list of (relativePath, afterContent) pairs to apply.
 * Callers inject the write function so this stays pure.
 */
export function buildApplyPlan(diffs: DiffResult[]): Array<{ path: string; after: string }> {
  return diffs.map((d) => ({ path: d.relative_path, after: d.after }));
}

/**
 * Execute an apply plan with snapshot-before-write and partial-apply rollback.
 * Takes injectable read/write functions so it is testable without real fs.
 */
export async function executeApplyPlan(
  plan: Array<{ path: string; after: string }>,
  workspaceRoot: string,
  readFile: (absPath: string) => Promise<string>,
  writeFile: (absPath: string, content: string) => Promise<void>,
): Promise<ApplyResult> {
  const snapshots = new Map<string, string>();
  const applied: string[] = [];
  const failed: string[] = [];

  // Phase 1: snapshot all targets before touching any of them.
  for (const item of plan) {
    const absPath = `${workspaceRoot.replace(/\/$/, "")}/${item.path}`;
    try {
      const prior = await readFile(absPath);
      snapshots.set(item.path, prior);
    } catch {
      // File does not exist yet — snapshot is empty string (new file).
      snapshots.set(item.path, "");
    }
  }

  // Phase 2: apply each file; on failure, report the failed set for rollback.
  for (const item of plan) {
    const absPath = `${workspaceRoot.replace(/\/$/, "")}/${item.path}`;
    try {
      await writeFile(absPath, item.after);
      applied.push(item.path);
    } catch (_err) {
      failed.push(item.path);
      break; // Stop on first failure — partial-apply state is in `applied`.
    }
  }

  return { applied, failed, snapshots };
}

/**
 * Revert applied files from snapshots (partial-apply rollback).
 * Returns paths that could not be reverted.
 */
export async function revertFromSnapshots(
  toRevert: string[],
  snapshots: Map<string, string>,
  workspaceRoot: string,
  writeFile: (absPath: string, content: string) => Promise<void>,
): Promise<string[]> {
  const failedRevert: string[] = [];
  for (const relPath of toRevert) {
    const prior = snapshots.get(relPath);
    if (prior === undefined) continue;
    const absPath = `${workspaceRoot.replace(/\/$/, "")}/${relPath}`;
    try {
      await writeFile(absPath, prior);
    } catch {
      failedRevert.push(relPath);
    }
  }
  return failedRevert;
}

// ── VS Code wiring (thin) ──────────────────────────────────────────────────────

/** Scheme for read-only virtual docs used in the native diff viewer. */
export const DIFF_SCHEME = "omnigent-diff";

/**
 * Register a TextDocumentContentProvider for omnigent-diff:// URIs.
 * Content is stored in memory keyed by the URI string.
 */
export class DiffContentProvider implements vscode.TextDocumentContentProvider {
  private _store = new Map<string, string>();
  private _emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._emitter.event;

  set(uri: vscode.Uri, content: string): void {
    this._store.set(uri.toString(), content);
    this._emitter.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this._store.get(uri.toString()) ?? "";
  }
}

function makeDiffUri(label: string, relativePath: string): vscode.Uri {
  return vscode.Uri.parse(
    `${DIFF_SCHEME}:/${encodeURIComponent(label)}/${encodeURIComponent(relativePath)}`,
  );
}

export function registerDiffsCommand(
  context: vscode.ExtensionContext,
  sessionState: SessionState,
  output: vscode.OutputChannel,
): { provider: DiffContentProvider; stopSse: () => void } {
  const diffProvider = new DiffContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, diffProvider),
  );

  // ── View diffs command ─────────────────────────────────────────────────────
  const viewCmd = vscode.commands.registerCommand(VIEW_DIFFS_COMMAND, async () => {
    const opts: ClientOptions | undefined = sessionState.clientOpts;
    const sessionId = sessionState.sessionId;
    if (!opts || !sessionId) {
      vscode.window.showWarningMessage("Omnigent: no active session.");
      return;
    }

    const filesResult = await listChangedFiles(opts, sessionId);
    if (!filesResult.ok || !filesResult.data) {
      vscode.window.showErrorMessage(`Omnigent: could not list changed files (${filesResult.status})`);
      return;
    }

    const files: ChangedFile[] = filesResult.data;
    if (files.length === 0) {
      vscode.window.showInformationMessage("Omnigent: no changed files.");
      return;
    }

    for (const file of files) {
      const envId = file.environment_id ?? "default";
      const diffResult = await fetchDiff(opts, sessionId, envId, file.relative_path);
      if (!diffResult.ok || !diffResult.data) {
        output.appendLine(`[omnigent] diff fetch failed for ${file.relative_path}: ${diffResult.error}`);
        continue;
      }
      const { before, after, relative_path } = diffResult.data;

      const beforeUri = makeDiffUri("before", relative_path);
      const afterUri = makeDiffUri("after", relative_path);
      diffProvider.set(beforeUri, before);
      diffProvider.set(afterUri, after);

      await vscode.commands.executeCommand(
        "vscode.diff",
        beforeUri,
        afterUri,
        `Omnigent diff: ${relative_path}`,
        { preview: true },
      );
    }
  });
  context.subscriptions.push(viewCmd);

  // ── Apply diffs command (local only) ───────────────────────────────────────
  const applyCmd = vscode.commands.registerCommand(APPLY_DIFFS_COMMAND, async () => {
    if (!isApplyAllowed(sessionState.hostType)) {
      vscode.window.showWarningMessage(
        "Omnigent: apply is only available for local sessions (session host type is remote/unknown).",
      );
      return;
    }

    const opts: ClientOptions | undefined = sessionState.clientOpts;
    const sessionId = sessionState.sessionId;
    if (!opts || !sessionId) {
      vscode.window.showWarningMessage("Omnigent: no active session.");
      return;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showWarningMessage("Omnigent: no workspace folder open.");
      return;
    }

    const filesResult = await listChangedFiles(opts, sessionId);
    if (!filesResult.ok || !filesResult.data?.length) {
      vscode.window.showInformationMessage("Omnigent: no changed files to apply.");
      return;
    }

    // Fetch all diffs then apply.
    const diffs: DiffResult[] = [];
    for (const file of filesResult.data) {
      const envId = file.environment_id ?? "default";
      const dr = await fetchDiff(opts, sessionId, envId, file.relative_path);
      if (dr.ok && dr.data) diffs.push(dr.data);
    }

    const plan = buildApplyPlan(diffs);
    output.appendLine(`[omnigent] applying ${plan.length} file(s)`);

    const result = await executeApplyPlan(
      plan,
      workspaceRoot,
      (p) => fs.readFile(p, "utf8"),
      (p, c) => fs.writeFile(p, c, "utf8"),
    );

    if (result.failed.length === 0) {
      vscode.window.showInformationMessage(
        `Omnigent: applied ${result.applied.length} file(s).`,
      );
      output.appendLine(`[omnigent] apply complete: ${result.applied.join(", ")}`);
    } else {
      // Partial-apply: offer rollback of the applied subset.
      const msg = `Omnigent: applied ${result.applied.length} file(s), failed ${result.failed.length}. Revert applied?`;
      const answer = await vscode.window.showWarningMessage(msg, "Revert Applied", "Keep");
      if (answer === "Revert Applied") {
        const failedRevert = await revertFromSnapshots(
          result.applied,
          result.snapshots,
          workspaceRoot,
          (p, c) => fs.writeFile(p, c, "utf8"),
        );
        if (failedRevert.length === 0) {
          vscode.window.showInformationMessage("Omnigent: reverted all applied files.");
        } else {
          vscode.window.showErrorMessage(
            `Omnigent: revert partial failure — could not revert: ${failedRevert.join(", ")}`,
          );
        }
      }
    }
  });
  context.subscriptions.push(applyCmd);

  // ── SSE subscription for changed_files invalidation ────────────────────────
  let stopSse: () => void = () => {};

  function startSseWatch(): void {
    const opts = sessionState.clientOpts;
    const sessionId = sessionState.sessionId;
    if (!opts || !sessionId) return;
    stopSse();
    output.appendLine(`[omnigent] starting SSE watch for session ${sessionId}`);
    stopSse = openSseStream(
      opts,
      sessionId,
      (event) => {
        if (isChangedFilesEvent(event)) {
          output.appendLine("[omnigent] changed_files.invalidated — run viewDiffs or applyDiffs");
          vscode.window.showInformationMessage(
            "Omnigent: files changed in session.",
            "View Diffs",
            "Apply Diffs",
          ).then((choice) => {
            if (choice === "View Diffs") {
              vscode.commands.executeCommand(VIEW_DIFFS_COMMAND);
            } else if (choice === "Apply Diffs") {
              vscode.commands.executeCommand(APPLY_DIFFS_COMMAND);
            }
          });
        }
      },
      (err) => output.appendLine(`[omnigent] SSE error: ${err}`),
    );
  }

  // Exposed so extension.ts can start the watch when a session is created.
  context.subscriptions.push({ dispose: () => stopSse() });

  return { provider: diffProvider, stopSse: startSseWatch };
}

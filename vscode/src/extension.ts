/**
 * Omnigent VS Code extension entry point.
 *
 * activate() wires:
 *  - Config / discovery / auth
 *  - Sessions TreeView (activity-bar sidebar) + its filter/refresh commands
 *  - EditorPanelController: the single editor-beside full-app surface
 *  - send-selection command
 *  - open-session command + status bar
 *  - view/apply diffs command + SSE watch
 */
import * as vscode from "vscode";
import { discoverLocalServer, DEFAULT_HEALTH_TIMEOUT_MS } from "./discovery";
import { resolveServerTarget } from "./config";
import { readSettings } from "./config/vscodeSettings";
import { resolveToken } from "./auth";
import { redact, redactObject } from "./redact";
import { EditorPanelController } from "./panel/EditorPanelController";
import { SessionsTreeProvider, SESSIONS_VIEW_ID } from "./sessions/SessionsTreeProvider";
import { makeSessionState } from "./commands/sessionState";
import { registerSendSelection } from "./commands/sendSelection";
import { registerOpenSession } from "./commands/openSession";
import { registerOpenPanel } from "./commands/openPanel";
import {
  registerOpenSessionFromTree,
  registerSessionsTreeCommands,
} from "./commands/sessionsTreeCommands";
import { registerDiffsCommand } from "./commands/diffs";
import type { ClientOptions } from "./api/client";

/** Background poll cadence for the Sessions tree (visible-only, diff-only). */
const SESSIONS_POLL_INTERVAL_MS = 15_000;

let output: vscode.OutputChannel | undefined;
let controller: EditorPanelController | undefined;
let sessionsPoll: ReturnType<typeof setInterval> | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  output = vscode.window.createOutputChannel("Omnigent");
  context.subscriptions.push(output);
  output.appendLine("[omnigent] activating");

  // ── Shared session state (read by send-selection / open-session / diffs) ──
  const sessionState = makeSessionState();

  // ── Single editor-beside full-app surface ────────────────────────────────
  controller = new EditorPanelController(context.extensionUri, output);
  const editorPanel = controller;

  // ── Sessions TreeView (activity-bar sidebar) ──────────────────────────────
  const sessionsProvider = new SessionsTreeProvider(() => sessionState.clientOpts, output);
  const treeView = vscode.window.createTreeView(SESSIONS_VIEW_ID, {
    treeDataProvider: sessionsProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(treeView);
  registerSessionsTreeCommands(context, sessionsProvider, output);
  registerOpenSessionFromTree(context, editorPanel, sessionState, output);

  // Refresh when the view becomes visible (cheap, user-initiated).
  context.subscriptions.push(
    treeView.onDidChangeVisibility((e) => {
      if (e.visible) void sessionsProvider.refresh();
    }),
  );

  // Background poll — runs only while the tree is visible; diff-only (no flash).
  sessionsPoll = setInterval(() => {
    if (treeView.visible) void sessionsProvider.refresh({ quiet: true });
  }, SESSIONS_POLL_INTERVAL_MS);

  // ── send-selection command ────────────────────────────────────────────────
  registerSendSelection(
    context,
    () => sessionState.clientOpts,
    () => sessionState.sessionId,
    output,
  );

  // ── open-session command + status bar ─────────────────────────────────────
  registerOpenSession(context, editorPanel, sessionState, output);

  // ── open-panel command (reveals the editor-beside full app) ───────────────
  registerOpenPanel(context, editorPanel);

  // ── diffs command + SSE watch ─────────────────────────────────────────────
  const { stopSse: startSseWatch } = registerDiffsCommand(context, sessionState, output);

  // ── Foundation: resolve server + auth at activation ───────────────────────
  try {
    const settings = readSettings();
    const discovery = await discoverLocalServer(undefined, DEFAULT_HEALTH_TIMEOUT_MS);
    const resolution = resolveServerTarget(settings, {
      found: discovery.found,
      baseUrl: discovery.found ? discovery.baseUrl : undefined,
      health: discovery.found ? discovery.health : undefined,
    });

    if (resolution.status === "resolved") {
      const target = resolution.target;
      const { resolved } = await resolveToken(target.origin, settings.token || null);

      const token =
        resolved.source === "manual" || resolved.source === "file"
          ? (resolved as { token: string }).token
          : undefined;

      // Build the client options used by all commands + the sessions list.
      const clientOpts: ClientOptions = { baseUrl: target.baseUrl, token };
      sessionState.clientOpts = clientOpts;
      sessionState.hostType = target.hostType;

      output.appendLine(
        `[omnigent] target: ${JSON.stringify(
          redactObject({
            baseUrl: target.baseUrl,
            origin: target.origin,
            hostType: target.hostType,
            source: target.source,
            tokenSource: resolved.source,
            token: redact(token ? "present" : ""),
          }),
        )}`,
      );

      // Hand the resolved target/token to the editor-panel controller.
      // If a panel was opened during this async window, setResolved re-renders it.
      editorPanel.setResolved(target, token);

      // Populate the sessions tree now that the server is known.
      void sessionsProvider.refresh();

      // Start SSE watch if a session is already active (e.g. after reload).
      if (sessionState.sessionId) startSseWatch();
    } else {
      output.appendLine(`[omnigent] no server target (${resolution.reason}); configure omnigent.serverUrl`);
      void sessionsProvider.refresh();
    }
  } catch (err) {
    output.appendLine(
      `[omnigent] init error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  output.appendLine("[omnigent] ready");
}

export function deactivate(): void {
  if (sessionsPoll) {
    clearInterval(sessionsPoll);
    sessionsPoll = undefined;
  }
  controller?.dispose();
  controller = undefined;
  output?.appendLine("[omnigent] deactivating");
  output = undefined;
}

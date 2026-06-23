/**
 * A8 — Native command: open/switch session + connection status bar.
 *
 * Deep-link works by posting omnigent/navigate to the webview (drives OmnigentApp
 * router via basename — NOT an iframe reload, per the A6a gate doc).
 *
 * Status-bar item shows: connection state (connecting/connected/error) + host type
 * (local/remote/unknown) derived from the config module.
 */
import * as vscode from "vscode";
import { createSession, ClientOptions } from "../api/client";
import type { OmnigentViewProvider } from "../panel/OmnigentViewProvider";
import type { SessionState } from "./sessionState";
import type { HostType } from "../config";

export const OPEN_SESSION_COMMAND = "omnigent.openSession";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

/** Pure: compute the status-bar label. Unit-testable. */
export function statusBarLabel(status: ConnectionStatus, hostType: HostType): string {
  const hostIcon = hostType === "local" ? "$(home)" : hostType === "remote" ? "$(cloud)" : "$(question)";
  const stateIcon =
    status === "connected"
      ? "$(check)"
      : status === "connecting"
        ? "$(sync~spin)"
        : status === "error"
          ? "$(error)"
          : "$(circle-slash)";
  return `Omnigent ${stateIcon} ${hostIcon}`;
}

/** Pure: compute status bar tooltip. Unit-testable. */
export function statusBarTooltip(
  status: ConnectionStatus,
  hostType: HostType,
  sessionId?: string,
): string {
  const stateStr =
    status === "connected"
      ? "Connected"
      : status === "connecting"
        ? "Connecting…"
        : status === "error"
          ? "Connection error"
          : "Not connected";
  const hostStr =
    hostType === "local" ? "Local server" : hostType === "remote" ? "Remote server" : "Unknown host";
  const sessionStr = sessionId ? `\nSession: ${sessionId}` : "";
  return `Omnigent — ${stateStr} (${hostStr})${sessionStr}`;
}

/** Register the open-session command and create the status-bar item. */
export function registerOpenSession(
  context: vscode.ExtensionContext,
  provider: OmnigentViewProvider,
  sessionState: SessionState,
  output: vscode.OutputChannel,
): vscode.StatusBarItem {
  // Status-bar item (priority 100 = right of centre).
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.command = OPEN_SESSION_COMMAND;
  statusItem.text = statusBarLabel("idle", "unknown");
  statusItem.tooltip = statusBarTooltip("idle", "unknown");
  statusItem.show();
  context.subscriptions.push(statusItem);

  const setStatus = (status: ConnectionStatus, opts?: { hostType?: HostType; sessionId?: string }) => {
    const ht = opts?.hostType ?? sessionState.hostType;
    statusItem.text = statusBarLabel(status, ht);
    statusItem.tooltip = statusBarTooltip(status, ht, opts?.sessionId ?? sessionState.sessionId);
  };

  const cmd = vscode.commands.registerCommand(OPEN_SESSION_COMMAND, async () => {
    // Focus the Omnigent panel (VS Code will call resolveWebviewView if needed).
    await vscode.commands.executeCommand("omnigent.panel.focus");

    const opts: ClientOptions | undefined = sessionState.clientOpts;
    if (!opts) {
      vscode.window.showWarningMessage("Omnigent: no server configured. Check omnigent.serverUrl.");
      return;
    }

    setStatus("connecting");
    output.appendLine("[omnigent] openSession: creating session…");

    const result = await createSession(opts);
    if (!result.ok || !result.data?.id) {
      setStatus("error");
      output.appendLine(`[omnigent] openSession: failed (${result.status}: ${result.error})`);
      vscode.window.showErrorMessage(`Omnigent: could not create session (${result.status})`);
      return;
    }

    const id = result.data.id;
    sessionState.sessionId = id;
    setStatus("connected", { sessionId: id });
    output.appendLine(`[omnigent] openSession: session ${id} created`);

    // Deep-link OmnigentApp to the session route (drives the embedded router).
    provider.postMessage({ type: "omnigent/navigate", route: `/c/${id}` });
  });

  context.subscriptions.push(cmd);
  return statusItem;
}

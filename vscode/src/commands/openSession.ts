/**
 * A8 — Native command: open/switch session + connection status bar.
 *
 * Deep-link works through the shared EditorPanelController, which navigates the
 * editor-beside panel to /c/<id> (iframe re-render or embed omnigent/navigate —
 * NOT an iframe reload on the embed path, per the A6a gate doc).
 *
 * Status-bar item shows: connection state (connecting/connected/error) + host type
 * (local/remote/unknown) derived from the config module.
 */
import * as vscode from "vscode";
import { createSession, listAgents, ClientOptions, Agent } from "../api/client";
import { readSettings } from "../config/vscodeSettings";
import type { EditorPanelController } from "../panel/EditorPanelController";
import type { SessionState } from "./sessionState";
import type { HostType } from "../config";

export const OPEN_SESSION_COMMAND = "omnigent.openSession";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

/** A QuickPick item carrying the agent id alongside its display fields. Pure shape. */
export interface AgentPickItem extends vscode.QuickPickItem {
  agentId: string;
}

/** Pure: map agents to QuickPick items (label=name, detail=description). Unit-testable. */
export function agentPickItems(agents: Agent[]): AgentPickItem[] {
  return agents.map((a) => ({
    label: a.name,
    detail: a.description,
    agentId: a.id,
  }));
}

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

/**
 * Resolve the agent id to create a session with. Uses the `omnigent.defaultAgentId`
 * setting when present; otherwise fetches the agent list and shows a QuickPick.
 * Returns `undefined` when the agent could not be resolved (error already shown)
 * or the user dismissed the picker.
 */
async function resolveAgentId(
  opts: ClientOptions,
  output: vscode.OutputChannel,
): Promise<string | undefined> {
  const settings = readSettings();
  if (settings.defaultAgentId && settings.defaultAgentId.trim() !== "") {
    return settings.defaultAgentId.trim();
  }

  output.appendLine("[omnigent] openSession: resolving agent (listing agents)…");
  const agentsResult = await listAgents(opts);
  if (!agentsResult.ok || !agentsResult.data || agentsResult.data.length === 0) {
    output.appendLine(
      `[omnigent] openSession: agent list unavailable (${agentsResult.status}: ${agentsResult.error ?? "empty"})`,
    );
    vscode.window.showErrorMessage(
      `Omnigent: could not list agents (${agentsResult.status}). Set omnigent.defaultAgentId or check the server.`,
    );
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(agentPickItems(agentsResult.data), {
    title: "Omnigent: select an agent",
    placeHolder: "Choose an agent to start the session",
    matchOnDetail: true,
  });
  return picked?.agentId;
}

/** Register the open-session command and create the status-bar item. */
export function registerOpenSession(
  context: vscode.ExtensionContext,
  controller: EditorPanelController,
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
    const opts: ClientOptions | undefined = sessionState.clientOpts;
    if (!opts) {
      vscode.window.showWarningMessage("Omnigent: no server configured. Check omnigent.serverUrl.");
      return;
    }

    // Resolve the agent to create the session with (server requires agent_id).
    const agentId = await resolveAgentId(opts, output);
    if (!agentId) {
      // resolveAgentId already surfaced any error / the user cancelled the picker.
      return;
    }

    setStatus("connecting");
    output.appendLine("[omnigent] openSession: creating session…");

    const result = await createSession(opts, agentId);
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

    // Deep-link the editor panel to the session route (opens/reveals + navigates).
    controller.navigate(`/c/${id}`);
  });

  context.subscriptions.push(cmd);
  return statusItem;
}

/**
 * A7 — Native command: send selection/file to the active Omnigent session.
 *
 * Pure functions (computeSelectionPayload, buildSendMessage) are unit-tested.
 * The thin VS Code parts (capturing selection, calling postSessionEvent) are
 * wired in registerSendSelection() which touches the vscode API.
 */
import * as vscode from "vscode";
import { buildMessageEvent, postSessionEvent, ClientOptions } from "../api/client";
import { redact } from "../redact";

export const SEND_SELECTION_COMMAND = "omnigent.sendSelection";

/** Pure: compute workspace-relative path from an absolute path + workspace root. */
export function workspaceRelativePath(
  absolutePath: string,
  workspaceRoot: string,
): string {
  const root = workspaceRoot.replace(/\/$/, "");
  if (absolutePath.startsWith(root + "/")) {
    return absolutePath.slice(root.length + 1);
  }
  return absolutePath; // fallback: use absolute if outside workspace
}

export interface SelectionPayload {
  content: string;
  relativePath?: string;
}

/**
 * Pure: compute the content + relative path from editor state.
 * Takes plain data (not the vscode API objects) so it is unit-testable.
 */
export function computeSelectionPayload(
  selectedText: string,
  absoluteFilePath: string | undefined,
  workspaceRoot: string | undefined,
): SelectionPayload {
  const content = selectedText.trim() || "(no selection)";
  if (!absoluteFilePath) return { content };
  const relativePath = workspaceRoot
    ? workspaceRelativePath(absoluteFilePath, workspaceRoot)
    : absoluteFilePath;
  return { content, relativePath };
}

/** Register the VS Code command. Called from extension.ts activate(). */
export function registerSendSelection(
  context: vscode.ExtensionContext,
  getClientOpts: () => ClientOptions | undefined,
  getSessionId: () => string | undefined,
  output: vscode.OutputChannel,
): void {
  const cmd = vscode.commands.registerCommand(SEND_SELECTION_COMMAND, async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage("Omnigent: open a file to send selection.");
      return;
    }
    const opts = getClientOpts();
    if (!opts) {
      vscode.window.showWarningMessage("Omnigent: no active server connection.");
      return;
    }
    const sessionId = getSessionId();
    if (!sessionId) {
      vscode.window.showWarningMessage("Omnigent: no active session. Open the Omnigent panel first.");
      return;
    }

    const selectedText = editor.document.getText(editor.selection);
    const absolutePath = editor.document.uri.fsPath;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    const payload = computeSelectionPayload(selectedText, absolutePath, workspaceRoot);
    const event = buildMessageEvent(payload.content, payload.relativePath);

    output.appendLine(
      `[omnigent] sendSelection: path=${payload.relativePath ?? "(none)"} token=${redact(opts.token)}`,
    );

    const result = await postSessionEvent(opts, sessionId, event);
    if (!result.ok) {
      vscode.window.showErrorMessage(`Omnigent: failed to send selection (${result.status}: ${result.error})`);
    }
  });
  context.subscriptions.push(cmd);
}

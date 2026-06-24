/**
 * A11 — "Omnigent: Open" command.
 *
 * The full Omnigent app renders only in the editor-beside `WebviewPanel`, owned
 * by the shared `EditorPanelController`. `omnigent.open` simply ensures that
 * panel is open and revealed; the controller owns the singleton, the resolved
 * server target/token, and the route.
 */
import * as vscode from "vscode";
import type { EditorPanelController } from "../panel/EditorPanelController";

export const OPEN_PANEL_COMMAND = "omnigent.open";

/** Register the `omnigent.open` command. Returns the disposable command. */
export function registerOpenPanel(
  context: vscode.ExtensionContext,
  controller: EditorPanelController,
): vscode.Disposable {
  const cmd = vscode.commands.registerCommand(OPEN_PANEL_COMMAND, () => {
    controller.ensure();
  });

  context.subscriptions.push(cmd);
  return cmd;
}

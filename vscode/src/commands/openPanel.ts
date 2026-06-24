/**
 * A11 — "Omnigent: Open" command and configurable panel placement.
 *
 * Reads `omnigent.panelLocation`:
 *  - `editor` → open a WebviewPanel beside the active editor (the guaranteed
 *    always-right option), rendered via the shared host helper so it matches the
 *    activity-bar view exactly.
 *  - `right` → focus the registered WebviewView, then best-effort move it to the
 *    secondary side bar (VS Code remembers the placement afterwards).
 *  - `left`  → focus the registered WebviewView in its activity-bar container.
 *
 * The editor panel reuses the provider's resolved server target / route / token,
 * so it renders identically to the docked view.
 */
import * as vscode from "vscode";
import type { OmnigentViewProvider } from "../panel/OmnigentViewProvider";
import { embedLocalResourceRoots, renderInto, renderResolvingHtml } from "../panel/host";
import { readSettings } from "../config/vscodeSettings";

export const OPEN_PANEL_COMMAND = "omnigent.open";

/** Register the `omnigent.open` command. Returns the disposable command. */
export function registerOpenPanel(
  context: vscode.ExtensionContext,
  provider: OmnigentViewProvider,
  output: vscode.OutputChannel,
): vscode.Disposable {
  // A single reusable editor panel — revealed if already open.
  let editorPanel: vscode.WebviewPanel | undefined;

  const renderEditorPanel = (panel: vscode.WebviewPanel) => {
    const target = provider.target;
    if (!target) {
      panel.webview.html = renderResolvingHtml();
      return;
    }
    renderInto(panel.webview, {
      target,
      extensionUri: context.extensionUri,
      renderMode: readSettings().renderMode,
      route: provider.route,
      token: provider.token,
      isDarkMode: vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark,
      log: (m) => output.appendLine(m),
    });
  };

  const cmd = vscode.commands.registerCommand(OPEN_PANEL_COMMAND, async () => {
    const { panelLocation } = readSettings();

    if (panelLocation === "editor") {
      if (editorPanel) {
        editorPanel.reveal(vscode.ViewColumn.Beside);
        return;
      }
      editorPanel = vscode.window.createWebviewPanel(
        "omnigent",
        "Omnigent",
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: embedLocalResourceRoots(context.extensionUri),
        },
      );
      editorPanel.onDidDispose(() => {
        editorPanel = undefined;
      });
      renderEditorPanel(editorPanel);
      output.appendLine("[omnigent] opened editor-beside panel");
      return;
    }

    // right | left → reveal the registered WebviewView.
    await vscode.commands.executeCommand("omnigent.panel.focus");

    if (panelLocation === "right") {
      // Best-effort: dock the focused view to the secondary side bar. This has no
      // stable contract and fights VS Code's remembered placement, so it is wrapped
      // and never fatal — once docked, VS Code remembers it.
      try {
        await vscode.commands.executeCommand("workbench.action.moveViewToSecondarySideBar");
      } catch (err) {
        output.appendLine(
          `[omnigent] moveViewToSecondarySideBar best-effort failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  });

  context.subscriptions.push(cmd);
  return cmd;
}

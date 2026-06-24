/**
 * Commands wiring the Sessions tree to the editor panel and to its
 * filter/refresh actions (plan §5.7). Thin VS Code adapter — the provider and
 * the pure filter module hold the logic.
 */
import * as vscode from "vscode";
import type { EditorPanelController } from "../panel/EditorPanelController";
import type { SessionsTreeProvider } from "../sessions/SessionsTreeProvider";
import { defaultFilter } from "../sessions/filter";
import type { SessionState } from "./sessionState";

export const OPEN_SESSION_FROM_TREE_COMMAND = "omnigent.openSessionFromTree";

/**
 * Register the command fired when a tree item is clicked: navigate the editor
 * panel to the session route and record it as the active session.
 */
export function registerOpenSessionFromTree(
  context: vscode.ExtensionContext,
  controller: EditorPanelController,
  sessionState: SessionState,
  output: vscode.OutputChannel,
): void {
  const cmd = vscode.commands.registerCommand(
    OPEN_SESSION_FROM_TREE_COMMAND,
    (id: string) => {
      if (!id) return;
      output.appendLine(`[omnigent] sessions: open ${id} from tree`);
      controller.navigate(`/c/${id}`);
      sessionState.sessionId = id;
    },
  );
  context.subscriptions.push(cmd);
}

/** Collect the distinct, defined values of a field across the loaded sessions. */
function distinctValues(
  provider: SessionsTreeProvider,
  pick: (s: { agent_name?: string; status?: string; git_branch?: string }) => string | undefined,
): string[] {
  const seen = new Set<string>();
  for (const s of provider.getSessions()) {
    const v = pick(s);
    if (v !== undefined && v !== "") seen.add(v);
  }
  return [...seen].sort();
}

/** Register the tree title-bar actions: refresh / filter / toggle / clear. */
export function registerSessionsTreeCommands(
  context: vscode.ExtensionContext,
  provider: SessionsTreeProvider,
  output: vscode.OutputChannel,
): void {
  const refresh = vscode.commands.registerCommand("omnigent.sessions.refresh", () => {
    void provider.refresh();
  });

  const filter = vscode.commands.registerCommand("omnigent.sessions.filter", async () => {
    // Pick the dimension to filter, then the value for that dimension.
    const dimension = await vscode.window.showQuickPick(
      [
        { label: "Agent", id: "agentName" as const },
        { label: "Status", id: "status" as const },
        { label: "Git Branch", id: "gitBranch" as const },
        { label: "Title contains…", id: "titleQuery" as const },
      ],
      { title: "Omnigent: filter sessions by…", placeHolder: "Choose a dimension" },
    );
    if (!dimension) return;

    if (dimension.id === "titleQuery") {
      const query = await vscode.window.showInputBox({
        title: "Omnigent: filter by title",
        placeHolder: "Substring to match (case-insensitive)",
      });
      if (query === undefined) return;
      provider.setFilter((f) => {
        f.titleQuery = query.trim() === "" ? undefined : query;
      });
      return;
    }

    const values = distinctValues(provider, (s) => {
      if (dimension.id === "agentName") return s.agent_name;
      if (dimension.id === "status") return s.status;
      return s.git_branch;
    });
    if (values.length === 0) {
      vscode.window.showInformationMessage(
        `Omnigent: no values to filter ${dimension.label.toLowerCase()} by.`,
      );
      return;
    }
    const value = await vscode.window.showQuickPick(values, {
      title: `Omnigent: filter by ${dimension.label.toLowerCase()}`,
      placeHolder: "Choose a value",
    });
    if (value === undefined) return;
    provider.setFilter((f) => {
      if (dimension.id === "agentName") f.agentName = value;
      else if (dimension.id === "status") f.status = value;
      else f.gitBranch = value;
    });
  });

  const toggleArchived = vscode.commands.registerCommand(
    "omnigent.sessions.toggleArchived",
    () => {
      provider.setFilter((f) => {
        f.hideArchived = !f.hideArchived;
      });
    },
  );

  const filterCurrentFolder = vscode.commands.registerCommand(
    "omnigent.sessions.filterCurrentFolder",
    () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      provider.setFilter((f) => {
        if (f.currentFolderOnly) {
          // Already on → toggle it off.
          f.currentFolderOnly = false;
          f.workspacePath = undefined;
        } else if (folder) {
          f.currentFolderOnly = true;
          f.workspacePath = folder.uri.fsPath;
        } else {
          output.appendLine("[omnigent] sessions: no workspace folder to filter by");
        }
      });
    },
  );

  const clearFilters = vscode.commands.registerCommand("omnigent.sessions.clearFilters", () => {
    provider.setFilter((f) => {
      const d = defaultFilter();
      f.hideArchived = d.hideArchived;
      f.currentFolderOnly = d.currentFolderOnly;
      f.workspacePath = undefined;
      f.gitBranch = undefined;
      f.agentName = undefined;
      f.status = undefined;
      f.titleQuery = undefined;
    });
  });

  context.subscriptions.push(refresh, filter, toggleArchived, filterCurrentFolder, clearFilters);
}

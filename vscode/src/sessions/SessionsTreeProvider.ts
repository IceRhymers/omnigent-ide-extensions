/**
 * Thin VS Code adapter exposing the Omnigent session list as a native TreeView
 * (plan §5.4). All filtering/sorting/view-model logic lives in the pure
 * `filter.ts` / `treeItem.ts` modules; this class owns only the IDE wiring and
 * the load lifecycle.
 */
import * as vscode from "vscode";
import { listSessions, type ClientOptions, type Session } from "../api/client";
import { defaultFilter, isFilterActive, matchesFilter, type SessionFilter } from "./filter";
import { sortSessions, toItemView } from "./treeItem";

export const SESSIONS_VIEW_ID = "omnigent.sessions";

/** Default ceiling for accumulated sessions (mirrors `listSessions` default). */
const SESSIONS_CAP = 200;

export type SessionsState = "loading" | "ready" | "error" | "no-server" | "unauthorized";

/** A tree node: either a real session or a single non-selectable message line. */
export type SessionsNode =
  | { kind: "session"; session: Session }
  | { kind: "message"; label: string };

export class SessionsTreeProvider implements vscode.TreeDataProvider<SessionsNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<SessionsNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private state: SessionsState = "loading";
  private sessions: Session[] = [];
  private truncated = false;
  private filter: SessionFilter = defaultFilter();
  /** Signature of the last rendered data, for diff-only (quiet) polling. */
  private lastSignature = "";

  constructor(
    private readonly getClientOpts: () => ClientOptions | undefined,
    private readonly output: vscode.OutputChannel,
  ) {}

  /**
   * Re-fetch sessions and update state, then fire a tree change.
   *
   * In `quiet` mode (used by the visible-only background poll), the transient
   * "loading" state is skipped and a tree change is fired ONLY when the data
   * actually changed (signature diff of sorted ids + updated_at + status) — so a
   * 15s poll over an unchanged list never flashes the view (plan §6.9).
   */
  async refresh(options?: { quiet?: boolean }): Promise<void> {
    const quiet = options?.quiet === true;
    const opts = this.getClientOpts();
    if (!opts) {
      this.applyResult("no-server", [], quiet);
      return;
    }

    if (!quiet) {
      this.state = "loading";
      this._onDidChangeTreeData.fire();
    }

    const res = await listSessions(opts, SESSIONS_CAP);
    if (!res.ok || !res.data) {
      if (res.status === 401 || res.status === 403) {
        this.applyResult("unauthorized", [], quiet);
      } else {
        this.output.appendLine(
          `[omnigent] sessions: list failed (${res.status}: ${res.error ?? "unknown"})`,
        );
        this.applyResult("error", [], quiet);
      }
    } else {
      this.applyResult("ready", res.data, quiet);
    }
  }

  /** Commit a fetch result; fire a change unless `quiet` and nothing changed. */
  private applyResult(state: SessionsState, sessions: Session[], quiet: boolean): void {
    this.state = state;
    this.sessions = sessions;
    // Truncation is reported when the accumulated total reached the cap.
    this.truncated = sessions.length >= SESSIONS_CAP;
    const signature = `${state}|${sessions
      .map((s) => `${s.id}:${s.updated_at ?? ""}:${s.status ?? ""}`)
      .join(",")}`;
    if (quiet && signature === this.lastSignature) return;
    this.lastSignature = signature;
    this._onDidChangeTreeData.fire();
  }

  getFilter(): SessionFilter {
    return this.filter;
  }

  /** Mutate the in-memory filter, update the `filterActive` context, and refresh. */
  setFilter(mutate: (f: SessionFilter) => void): void {
    mutate(this.filter);
    void vscode.commands.executeCommand(
      "setContext",
      "omnigent.filterActive",
      isFilterActive(this.filter),
    );
    void this.refresh();
  }

  /** The sessions currently loaded (used by the filter QuickPick to derive choices). */
  getSessions(): Session[] {
    return this.sessions;
  }

  getTreeItem(node: SessionsNode): vscode.TreeItem {
    if (node.kind === "message") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.contextValue = "omnigentMessage";
      return item;
    }
    const view = toItemView(node.session, Date.now());
    const item = new vscode.TreeItem(view.label, vscode.TreeItemCollapsibleState.None);
    item.id = view.id;
    item.description = view.description;
    item.tooltip = new vscode.MarkdownString(view.tooltip);
    item.iconPath = new vscode.ThemeIcon(view.themeIconId);
    item.contextValue = view.contextValue;
    item.command = {
      command: "omnigent.openSessionFromTree",
      title: "Open Session",
      arguments: [view.id],
    };
    return item;
  }

  getChildren(element?: SessionsNode): SessionsNode[] {
    // Flat list — sessions have no children.
    if (element) return [];

    if (this.state === "loading") return [message("Loading…")];
    if (this.state === "no-server") return [message("Omnigent server unreachable")];
    if (this.state === "unauthorized") {
      return [message("Not authorized (401/403) — check your token")];
    }
    if (this.state === "error") return [message("Omnigent server unreachable")];

    if (this.sessions.length === 0) return [message("No sessions")];

    const visible = sortSessions(this.sessions.filter((s) => matchesFilter(s, this.filter)));
    if (visible.length === 0) return [message("No sessions match the active filter")];

    const nodes: SessionsNode[] = visible.map((session) => ({ kind: "session", session }));
    if (this.truncated) {
      nodes.push(message(`Showing first ${this.sessions.length}`));
    }
    return nodes;
  }
}

function message(label: string): SessionsNode {
  return { kind: "message", label };
}

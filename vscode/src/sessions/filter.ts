/**
 * Pure, opt-in session filtering for the Sessions tree (plan §5.1).
 *
 * Filters are AND-combined: a session matches only when it satisfies every
 * active dimension. The default filter hides archived sessions and nothing
 * else. No VS Code imports — unit-testable in isolation.
 */
import type { Session } from "../api/client";

export interface SessionFilter {
  /** Drop sessions with `archived === true`. */
  hideArchived: boolean;
  /** Restrict to sessions whose workspace matches `workspacePath`. */
  currentFolderOnly: boolean;
  workspacePath?: string;
  gitBranch?: string;
  agentName?: string;
  status?: string;
  /** Case-insensitive substring match on the session title. */
  titleQuery?: string;
}

/** The default filter: hide archived, everything else off. */
export function defaultFilter(): SessionFilter {
  return { hideArchived: true, currentFolderOnly: false };
}

/**
 * Normalize a workspace path for comparison: trim a trailing slash, normalize
 * separators to `/`, and lowercase on case-insensitive platforms (darwin/win32).
 */
export function normalizeWorkspacePath(p: string): string {
  let out = p.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (process.platform === "darwin" || process.platform === "win32") {
    out = out.toLowerCase();
  }
  return out;
}

/** True when the session satisfies every active dimension of the filter (AND). */
export function matchesFilter(s: Session, f: SessionFilter): boolean {
  if (f.hideArchived && s.archived === true) return false;

  if (f.currentFolderOnly || f.workspacePath !== undefined) {
    if (f.workspacePath === undefined) return false;
    if (s.workspace === undefined) return false;
    if (normalizeWorkspacePath(s.workspace) !== normalizeWorkspacePath(f.workspacePath)) {
      return false;
    }
  }

  if (f.gitBranch !== undefined && s.git_branch !== f.gitBranch) return false;
  if (f.agentName !== undefined && s.agent_name !== f.agentName) return false;
  if (f.status !== undefined && s.status !== f.status) return false;

  if (f.titleQuery !== undefined && f.titleQuery.trim() !== "") {
    const title = (s.title ?? "").toLowerCase();
    if (!title.includes(f.titleQuery.toLowerCase())) return false;
  }

  return true;
}

/** True when any field differs from the default filter (i.e. a filter is active). */
export function isFilterActive(f: SessionFilter): boolean {
  const d = defaultFilter();
  return (
    f.hideArchived !== d.hideArchived ||
    f.currentFolderOnly !== d.currentFolderOnly ||
    f.workspacePath !== undefined ||
    f.gitBranch !== undefined ||
    f.agentName !== undefined ||
    f.status !== undefined ||
    (f.titleQuery !== undefined && f.titleQuery.trim() !== "")
  );
}

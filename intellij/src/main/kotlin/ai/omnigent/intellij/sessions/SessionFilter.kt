package ai.omnigent.intellij.sessions

import ai.omnigent.intellij.api.Session

/**
 * Pure, opt-in session filtering for the Sessions tool window (plan Phase 2).
 *
 * Filters are AND-combined: a session matches only when it satisfies every
 * active dimension. The default filter hides archived sessions and nothing
 * else. NO IntelliJ-platform imports — unit-testable and conformance-tested in
 * isolation.
 *
 * Mirrors vscode/src/sessions/filter.ts byte-for-byte on the observable
 * contract (matchesFilter / isFilterActive / defaultFilter). The path-casing
 * branch of [normalizeWorkspacePath] is platform-conditional and therefore
 * EXCLUDED from the shared conformance vector (tested language-locally).
 */

/**
 * The active filter. `null` for an optional field means the dimension is off;
 * the two booleans are always present (the default has `hideArchived = true`).
 */
data class SessionFilter(
    /** Drop sessions with `archived == true`. */
    val hideArchived: Boolean,
    /** Restrict to sessions whose workspace matches [workspacePath]. */
    val currentFolderOnly: Boolean,
    val workspacePath: String? = null,
    val gitBranch: String? = null,
    val agentName: String? = null,
    val status: String? = null,
    /** Case-insensitive substring match on the session title. */
    val titleQuery: String? = null,
)

/** The default filter: hide archived, everything else off. */
fun defaultFilter(): SessionFilter = SessionFilter(hideArchived = true, currentFolderOnly = false)

/**
 * Normalize a workspace path for comparison: trim, normalize separators to `/`,
 * strip trailing slashes, and lowercase ONLY on case-insensitive platforms
 * (macOS/Windows). Mirrors the TS `process.platform === "darwin" | "win32"`
 * guard. Linux preserves case.
 */
fun normalizeWorkspacePath(p: String): String {
    var out = p.trim().replace("\\", "/").trimEnd('/')
    val osName = System.getProperty("os.name")?.lowercase() ?: ""
    val caseInsensitive = osName.contains("mac") || osName.contains("darwin") || osName.contains("win")
    if (caseInsensitive) {
        out = out.lowercase()
    }
    return out
}

/** True when the session satisfies every active dimension of the filter (AND). */
fun matchesFilter(s: Session, f: SessionFilter): Boolean {
    if (f.hideArchived && s.archived == true) return false

    if (f.currentFolderOnly || f.workspacePath != null) {
        if (f.workspacePath == null) return false
        if (s.workspace == null) return false
        if (normalizeWorkspacePath(s.workspace) != normalizeWorkspacePath(f.workspacePath)) {
            return false
        }
    }

    if (f.gitBranch != null && s.gitBranch != f.gitBranch) return false
    if (f.agentName != null && s.agentName != f.agentName) return false
    if (f.status != null && s.status != f.status) return false

    if (f.titleQuery != null && f.titleQuery.trim() != "") {
        // Match the UNTRIMMED query lowercased as a substring of the lowercased
        // title. lowercase() uses the invariant/root locale to avoid Turkish-I
        // divergence from JS String.prototype.toLowerCase().
        val title = (s.title ?: "").lowercase()
        if (!title.contains(f.titleQuery.lowercase())) return false
    }

    return true
}

/** True when any field differs from the default filter (i.e. a filter is active). */
fun isFilterActive(f: SessionFilter): Boolean {
    val d = defaultFilter()
    return f.hideArchived != d.hideArchived ||
        f.currentFolderOnly != d.currentFolderOnly ||
        f.workspacePath != null ||
        f.gitBranch != null ||
        f.agentName != null ||
        f.status != null ||
        (f.titleQuery != null && f.titleQuery.trim() != "")
}

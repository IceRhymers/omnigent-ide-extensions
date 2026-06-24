package ai.omnigent.intellij.sessions

import ai.omnigent.intellij.api.Session

/**
 * Pure view-model derivation for Sessions list items (plan Phase 2).
 *
 * NO IntelliJ-platform imports: produces a plain [SessionItemView] (a stable
 * status-icon *identifier* string, description, tooltip) that the thin Phase 3
 * renderer maps onto a Swing cell + an `AllIcons` icon. Unit-testable and
 * conformance-tested in isolation.
 *
 * Mirrors vscode/src/sessions/treeItem.ts on the portable contracts
 * (deriveLabel / relativeTime / toItemView / sortSessions). [statusIconId]
 * deliberately DIVERGES from VS Code's ThemeIcon ids — it returns IntelliJ-bound
 * identifiers (see [SessionStatusIcon]) and is therefore excluded from the
 * shared vector and tested language-locally.
 */

/**
 * Stable, platform-neutral identifiers for the session status icon. Phase 3's
 * renderer maps these to `com.intellij.icons.AllIcons` instances — kept as a
 * plain enum here so this pure module needs no platform import.
 */
enum class SessionStatusIcon(val id: String) {
    ARCHIVED("archived"),
    RUNNING("running"),
    IDLE("idle"),
    ERROR("error"),
}

/** The fully-derived view-model for a single session row. */
data class SessionItemView(
    val id: String,
    val label: String,
    val description: String,
    val tooltip: String,
    val statusIcon: SessionStatusIcon,
    val contextValue: String,
)

/** A readable label: the title when present, else a short fallback from the id. */
fun deriveLabel(s: Session): String {
    val title = s.title
    if (title != null && title.trim() != "") return title.trim()
    val id = s.id
    // Strip a "conv_" style prefix and keep a short, readable tail.
    val tail = if (id.contains("_")) id.substring(id.indexOf("_") + 1) else id
    val short = tail.take(8)
    return if (short.isNotEmpty()) "Session $short" else "Session"
}

/** Render a unix-SECONDS timestamp as a coarse relative time ("just now", "3m ago"…). */
fun relativeTime(unixSecs: Long, nowMs: Long): String {
    val thenMs = unixSecs * 1000
    // Match JS: Math.max(0, Math.round((nowMs - thenMs) / 1000)). Math.round is
    // round-half-up for positive values, matching java.lang.Math.round on the
    // double quotient.
    val diffSec = maxOf(0L, Math.round((nowMs - thenMs) / 1000.0))
    if (diffSec < 60) return "just now"
    val min = diffSec / 60 // integer division == Math.floor for non-negatives
    if (min < 60) return "${min}m ago"
    val hr = min / 60
    if (hr < 24) return "${hr}h ago"
    val day = hr / 24
    return "${day}d ago"
}

/** Map a session status/archived flag to a stable status-icon identifier. */
fun statusIconId(status: String?, archived: Boolean?): SessionStatusIcon {
    if (archived == true) return SessionStatusIcon.ARCHIVED
    val s = (status ?: "").lowercase()
    if (s == "running") return SessionStatusIcon.RUNNING
    if (s == "idle") return SessionStatusIcon.IDLE
    if (s.contains("error") || s.contains("fail")) return SessionStatusIcon.ERROR
    return SessionStatusIcon.IDLE
}

/** Build the full item view-model for a session at the given wall-clock time. */
fun toItemView(s: Session, nowMs: Long): SessionItemView {
    val label = deriveLabel(s)
    val parts = mutableListOf<String>()
    s.agentName?.let { if (it.isNotEmpty()) parts.add(it) }
    s.updatedAt?.let { parts.add(relativeTime(it, nowMs)) }
    val description = parts.joinToString(" · ")

    val tipLines = mutableListOf<String>()
    s.workspace?.let { if (it.isNotEmpty()) tipLines.add("Workspace: $it") }
    s.gitBranch?.let { if (it.isNotEmpty()) tipLines.add("Branch: $it") }
    s.status?.let { if (it.isNotEmpty()) tipLines.add("Status: $it") }
    s.createdAt?.let { tipLines.add("Created: ${relativeTime(it, nowMs)}") }
    s.updatedAt?.let { tipLines.add("Updated: ${relativeTime(it, nowMs)}") }
    val tooltip = if (tipLines.isNotEmpty()) "$label\n\n${tipLines.joinToString("\n")}" else label

    return SessionItemView(
        id = s.id,
        label = label,
        description = description,
        tooltip = tooltip,
        statusIcon = statusIconId(s.status, s.archived),
        contextValue = "omnigentSession",
    )
}

/** Copy and sort by `updatedAt` descending, with id as a stable tiebreak. */
fun sortSessions(list: List<Session>): List<Session> =
    list.sortedWith(
        Comparator { a, b ->
            val au = a.updatedAt ?: 0L
            val bu = b.updatedAt ?: 0L
            if (bu != au) {
                // desc by updatedAt; compareTo handles the full Long range
                bu.compareTo(au)
            } else {
                // lexicographic tiebreak on id, matching JS `<` / `>`.
                when {
                    a.id < b.id -> -1
                    a.id > b.id -> 1
                    else -> 0
                }
            }
        },
    )

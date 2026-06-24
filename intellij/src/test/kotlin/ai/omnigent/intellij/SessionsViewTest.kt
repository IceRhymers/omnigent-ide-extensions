package ai.omnigent.intellij

import ai.omnigent.intellij.api.Session
import ai.omnigent.intellij.sessions.SessionStatusIcon
import ai.omnigent.intellij.sessions.normalizeWorkspacePath
import ai.omnigent.intellij.sessions.statusIconId
import ai.omnigent.intellij.sessions.toItemView
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals

/**
 * Language-local, platform-pinned unit tests for the two Sessions-picker
 * contracts deliberately EXCLUDED from the shared session-filter.json vector:
 *   - normalizeWorkspacePath path-CASING (lowercases only on macOS/Windows)
 *   - statusIconId / icon mapping (IntelliJ identifiers, deliberately divergent
 *     from VS Code's ThemeIcon ids)
 *
 * The portable contracts (matchesFilter / isFilterActive / sortSessions /
 * computeSignature / relativeTime) are covered by the shared vector instead.
 */
class SessionsViewTest {

    private val caseInsensitiveOs: Boolean = run {
        val os = System.getProperty("os.name")?.lowercase() ?: ""
        os.contains("mac") || os.contains("darwin") || os.contains("win")
    }

    // ── normalizeWorkspacePath: case-sensitive transform always ────────────────
    @Test
    fun normalize_trimsAndNormalizesSeparators() {
        // The structural transform (trim, \ -> /, strip trailing /) is platform-INDEPENDENT.
        assertEquals("/a/b", normalizeWorkspacePath("  /a/b/  "))
        assertEquals("/a/b", normalizeWorkspacePath("/a/b///"))
    }

    @Test
    fun normalize_backslashesBecomeForwardSlashes() {
        // Drive-letter case follows the platform-casing branch (asserted below),
        // so check the separator transform with an already-lowercase path.
        assertEquals("c:/a/b", normalizeWorkspacePath("c:\\a\\b\\"))
    }

    // ── normalizeWorkspacePath: casing is platform-pinned ──────────────────────
    @Test
    fun normalize_casingFollowsPlatform() {
        val out = normalizeWorkspacePath("/A/B")
        if (caseInsensitiveOs) {
            // macOS / Windows: case-insensitive -> lowercased.
            assertEquals("/a/b", out)
        } else {
            // Linux: case preserved.
            assertEquals("/A/B", out)
        }
    }

    // ── statusIconId mapping (IntelliJ identifiers) ────────────────────────────
    @Test
    fun statusIcon_archivedWins() {
        assertEquals(SessionStatusIcon.ARCHIVED, statusIconId("running", true))
    }

    @Test
    fun statusIcon_mapsKnownStatuses() {
        assertEquals(SessionStatusIcon.RUNNING, statusIconId("running", null))
        assertEquals(SessionStatusIcon.IDLE, statusIconId("idle", null))
        assertEquals(SessionStatusIcon.ERROR, statusIconId("error", null))
        assertEquals(SessionStatusIcon.ERROR, statusIconId("failed", null))
    }

    @Test
    fun statusIcon_fallsBackToIdle() {
        assertEquals(SessionStatusIcon.IDLE, statusIconId(null, null))
        assertEquals(SessionStatusIcon.IDLE, statusIconId("something", null))
    }

    // ── toItemView smoke (derived label / description / tooltip / icon) ─────────
    @Test
    fun toItemView_buildsFullViewModel() {
        val now = 1_700_000_000_000L
        val view = toItemView(
            Session(
                id = "conv_1",
                title = "My session",
                agentName = "coder",
                status = "running",
                workspace = "/repo",
                gitBranch = "main",
                createdAt = now / 1000 - 3600,
                updatedAt = now / 1000 - 120,
            ),
            now,
        )
        assertEquals("conv_1", view.id)
        assertEquals("My session", view.label)
        assertEquals("coder · 2m ago", view.description)
        assertEquals(SessionStatusIcon.RUNNING, view.statusIcon)
        assertEquals("omnigentSession", view.contextValue)
        assertEquals(true, view.tooltip.contains("Workspace: /repo"))
        assertEquals(true, view.tooltip.contains("Branch: main"))
    }

    @Test
    fun toItemView_minimalSession() {
        val now = 1_700_000_000_000L
        val view = toItemView(Session(id = "conv_zz"), now)
        assertEquals("Session zz", view.label)
        assertEquals("", view.description)
        assertEquals("Session zz", view.tooltip)
    }
}

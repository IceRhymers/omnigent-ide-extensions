package ai.omnigent.intellij

import ai.omnigent.intellij.api.Session
import ai.omnigent.intellij.sessions.computeSignature
import ai.omnigent.intellij.sessions.shouldUpdateModel
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/**
 * Phase 4 pure-logic tests (no IDE host): the quiet/diff-equality contract that
 * makes a visible-only 15s poll a no-op when the server data is unchanged, and
 * the pure [shouldUpdateModel] decision factored out of the EDT-marshalling path.
 *
 * Plain JUnit5 — runs under useJUnitPlatform() without the platform fixture.
 */
class SessionsPollingTest {

    private val state = "LOADED"

    // ── computeSignature diff-equality (the no-flash guarantee) ────────────────

    @Test
    fun signature_identicalData_isStable() {
        val a = listOf(
            Session(id = "conv_a", updatedAt = 100, status = "running"),
            Session(id = "conv_b", updatedAt = 200, status = "idle"),
        )
        // A fresh list with the SAME field values must produce the SAME signature
        // so a quiet poll short-circuits and the JBList model is never touched.
        val b = listOf(
            Session(id = "conv_a", updatedAt = 100, status = "running"),
            Session(id = "conv_b", updatedAt = 200, status = "idle"),
        )
        assertEquals(computeSignature(state, a), computeSignature(state, b))
    }

    @Test
    fun signature_changedUpdatedAt_differs() {
        val before = listOf(Session(id = "conv_a", updatedAt = 100, status = "running"))
        val after = listOf(Session(id = "conv_a", updatedAt = 101, status = "running"))
        assertNotEquals(computeSignature(state, before), computeSignature(state, after))
    }

    @Test
    fun signature_changedStatus_differs() {
        val before = listOf(Session(id = "conv_a", updatedAt = 100, status = "running"))
        val after = listOf(Session(id = "conv_a", updatedAt = 100, status = "idle"))
        assertNotEquals(computeSignature(state, before), computeSignature(state, after))
    }

    @Test
    fun signature_changedMembership_differs() {
        val before = listOf(Session(id = "conv_a", updatedAt = 100, status = "running"))
        val after = listOf(
            Session(id = "conv_a", updatedAt = 100, status = "running"),
            Session(id = "conv_b", updatedAt = 200, status = "idle"),
        )
        assertNotEquals(computeSignature(state, before), computeSignature(state, after))
    }

    // ── shouldUpdateModel decision ─────────────────────────────────────────────

    @Test
    fun shouldUpdate_nonQuiet_alwaysRebuilds() {
        // First load / user refresh / become-visible: rebuild even if unchanged.
        assertTrue(shouldUpdateModel(quiet = false, oldSignature = null, newSignature = "x"))
        assertTrue(shouldUpdateModel(quiet = false, oldSignature = "x", newSignature = "x"))
    }

    @Test
    fun shouldUpdate_quietUnchanged_skips() {
        // The no-op poll: same signature -> do NOT touch the model (no flash).
        assertFalse(shouldUpdateModel(quiet = true, oldSignature = "x", newSignature = "x"))
    }

    @Test
    fun shouldUpdate_quietChanged_rebuilds() {
        assertTrue(shouldUpdateModel(quiet = true, oldSignature = "x", newSignature = "y"))
        // No prior signature yet (first quiet apply) is also a change.
        assertTrue(shouldUpdateModel(quiet = true, oldSignature = null, newSignature = "y"))
    }
}

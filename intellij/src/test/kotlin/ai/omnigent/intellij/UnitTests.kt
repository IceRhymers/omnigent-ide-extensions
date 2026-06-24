package ai.omnigent.intellij

import ai.omnigent.intellij.actions.DiffApply
import ai.omnigent.intellij.actions.Workspace
import ai.omnigent.intellij.api.DiffResult
import ai.omnigent.intellij.api.OmnigentPayloads
import ai.omnigent.intellij.api.SseEvent
import ai.omnigent.intellij.config.DiscoverySummary
import ai.omnigent.intellij.config.HostType
import ai.omnigent.intellij.config.ServerTarget
import ai.omnigent.intellij.config.ServerTargetResolver
import ai.omnigent.intellij.config.Settings
import ai.omnigent.intellij.config.TargetResolution
import ai.omnigent.intellij.discovery.HealthOutcome
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Targeted unit tests for the action payload / diff / apply-gating / config logic (B5). */
class UnitTests {

    // ── send-selection payload ───────────────────────────────────────────────
    @Test
    fun workspaceRelativePath_insideRoot() {
        assertEquals(
            "src/foo.kt",
            Workspace.workspaceRelativePath("/home/me/proj/src/foo.kt", "/home/me/proj"),
        )
    }

    @Test
    fun workspaceRelativePath_outsideRoot_fallsBackToAbsolute() {
        assertEquals(
            "/etc/passwd",
            Workspace.workspaceRelativePath("/etc/passwd", "/home/me/proj"),
        )
    }

    @Test
    fun computeSelectionPayload_emptySelection() {
        val p = Workspace.computeSelectionPayload("   ", "/r/a.kt", "/r")
        assertEquals("(no selection)", p.content)
        assertEquals("a.kt", p.relativePath)
    }

    @Test
    fun computeSelectionPayload_noFile() {
        val p = Workspace.computeSelectionPayload("hi", null, "/r")
        assertEquals("hi", p.content)
        assertNull(p.relativePath)
    }

    @Test
    fun buildMessageEvent_withContext() {
        val event = OmnigentPayloads.buildMessageEvent("hello", "src/a.kt")
        assertEquals("message", event["type"]!!.jsonPrimitive.content)
        assertEquals("hello", event["content"]!!.jsonPrimitive.content)
        assertEquals("src/a.kt", event["context"]!!.jsonObject["file"]!!.jsonPrimitive.content)
    }

    @Test
    fun buildMessageEvent_withoutContext() {
        val event = OmnigentPayloads.buildMessageEvent("hello", null)
        assertNull(event["context"])
    }

    // ── diff parsing + SSE ────────────────────────────────────────────────────
    @Test
    fun parseChangedFiles() {
        val raw = """[{"file_id":"f1","relative_path":"a.kt","environment_id":"env1"},{"file_id":"f2","relative_path":"b.kt"}]"""
        val files = OmnigentPayloads.parseChangedFiles(raw)
        assertEquals(2, files.size)
        assertEquals("f1", files[0].fileId)
        assertEquals("env1", files[0].environmentId)
        assertNull(files[1].environmentId)
    }

    @Test
    fun parseSessionId() {
        assertEquals("sess-1", OmnigentPayloads.parseSessionId("""{"id":"sess-1","status":"active"}"""))
        assertNull(OmnigentPayloads.parseSessionId("""{"status":"active"}"""))
    }

    @Test
    fun parseAgents() {
        val raw = """[{"id":"ag_1","name":"Builder","description":"Writes code"},{"id":"ag_2","name":"Reviewer"}]"""
        val agents = OmnigentPayloads.parseAgents(raw)
        assertEquals(2, agents.size)
        assertEquals("ag_1", agents[0].id)
        assertEquals("Builder", agents[0].name)
        assertEquals("Writes code", agents[0].description)
        assertEquals("ag_2", agents[1].id)
        assertNull(agents[1].description)
    }

    @Test
    fun parseAgents_malformedIsEmpty() {
        assertTrue(OmnigentPayloads.parseAgents("not json").isEmpty())
        // Entries missing required id/name are dropped.
        assertTrue(OmnigentPayloads.parseAgents("""[{"name":"NoId"}]""").isEmpty())
    }

    @Test
    fun buildCreateSessionBody_includesAgentId() {
        val body = OmnigentPayloads.buildCreateSessionBody("ag_42")
        assertEquals("ag_42", body["agent_id"]!!.jsonPrimitive.content)
        assertEquals("""{"agent_id":"ag_42"}""", body.toString())
    }

    @Test
    fun isChangedFilesEvent() {
        assertTrue(OmnigentPayloads.isChangedFilesEvent(SseEvent("session.changed_files.invalidated", "{}")))
        assertFalse(OmnigentPayloads.isChangedFilesEvent(SseEvent("other.event", "{}")))
    }

    @Test
    fun parseSseChunk() {
        val chunk = "event: foo\ndata: hello\n\nevent: bar\ndata: world\n\n"
        val events = OmnigentPayloads.parseSseChunk(chunk)
        assertEquals(2, events.size)
        assertEquals("foo", events[0].event)
        assertEquals("hello", events[0].data)
        assertEquals("world", events[1].data)
    }

    @Test
    fun encodePath_preservesSlashesEncodesSegments() {
        assertEquals("src/my%20file.kt", OmnigentPayloads.encodePath("src/my file.kt"))
    }

    // ── apply gating + snapshot + rollback ─────────────────────────────────────
    @Test
    fun isApplyAllowed_localOnly() {
        assertTrue(DiffApply.isApplyAllowed(HostType.LOCAL))
        assertFalse(DiffApply.isApplyAllowed(HostType.REMOTE))
        assertFalse(DiffApply.isApplyAllowed(HostType.UNKNOWN))
    }

    @Test
    fun executeApplyPlan_snapshotsThenApplies() {
        val plan = listOf("a.kt" to "newA", "b.kt" to "newB")
        val store = mutableMapOf("/r/a.kt" to "oldA", "/r/b.kt" to "oldB")
        val result = DiffApply.executeApplyPlan(
            plan,
            "/r",
            readFile = { abs -> store[abs] ?: throw NoSuchElementException(abs) },
            writeFile = { abs, content -> store[abs] = content },
        )
        assertEquals(listOf("a.kt", "b.kt"), result.applied)
        assertTrue(result.failed.isEmpty())
        assertEquals("oldA", result.snapshots["a.kt"])
        assertEquals("oldB", result.snapshots["b.kt"])
        assertEquals("newA", store["/r/a.kt"])
    }

    @Test
    fun executeApplyPlan_newFileSnapshotIsEmpty() {
        val store = mutableMapOf<String, String>()
        val result = DiffApply.executeApplyPlan(
            listOf("new.kt" to "content"),
            "/r",
            readFile = { abs -> store[abs] ?: throw NoSuchElementException(abs) },
            writeFile = { abs, content -> store[abs] = content },
        )
        assertEquals("", result.snapshots["new.kt"])
        assertEquals(listOf("new.kt"), result.applied)
    }

    @Test
    fun executeApplyPlan_partialFailureStopsAndReports() {
        val store = mutableMapOf("/r/a.kt" to "oldA", "/r/b.kt" to "oldB")
        val result = DiffApply.executeApplyPlan(
            listOf("a.kt" to "newA", "b.kt" to "newB"),
            "/r",
            readFile = { abs -> store[abs] ?: "" },
            writeFile = { abs, content ->
                if (abs.endsWith("b.kt")) throw RuntimeException("disk full")
                store[abs] = content
            },
        )
        assertEquals(listOf("a.kt"), result.applied)
        assertEquals(listOf("b.kt"), result.failed)
    }

    @Test
    fun revertFromSnapshots_restoresPriorContent() {
        val store = mutableMapOf("/r/a.kt" to "newA")
        val snapshots = mapOf("a.kt" to "oldA")
        val failed = DiffApply.revertFromSnapshots(
            listOf("a.kt"),
            snapshots,
            "/r",
            writeFile = { abs, content -> store[abs] = content },
        )
        assertTrue(failed.isEmpty())
        assertEquals("oldA", store["/r/a.kt"])
    }

    @Test
    fun buildApplyPlan_mapsRelativePathAndAfter() {
        val diffs = listOf(DiffResult("before", "after", "x.kt"))
        assertEquals(listOf("x.kt" to "after"), DiffApply.buildApplyPlan(diffs))
    }

    @Test
    fun parseDiffResponse_missingFieldsDefaultToEmpty() {
        val obj = kotlinx.serialization.json.buildJsonObject {
            put("before", kotlinx.serialization.json.JsonPrimitive("a"))
        }
        val result = OmnigentPayloads.parseDiffResponse(obj, "x.kt")
        assertEquals("a", result.before)
        assertEquals("", result.after)
        assertEquals("x.kt", result.relativePath)
    }

    // ── config: server-target + host-type resolution ───────────────────────────
    @Test
    fun resolve_manualOverrideWins() {
        val res = ServerTargetResolver.resolve(
            Settings(serverUrl = "https://omnigent.example.com"),
            DiscoverySummary(found = true, baseUrl = "http://127.0.0.1:6767", health = HealthOutcome.OK),
        )
        res as TargetResolution.Resolved
        assertEquals("https://omnigent.example.com", res.target.baseUrl)
        assertEquals(HostType.REMOTE, res.target.hostType)
        assertEquals(ServerTarget.Source.MANUAL, res.target.source)
    }

    @Test
    fun resolve_manualLoopbackIsLocal() {
        val res = ServerTargetResolver.resolve(
            Settings(serverUrl = "http://127.0.0.1:6767"),
            DiscoverySummary(found = false),
        )
        res as TargetResolution.Resolved
        assertEquals(HostType.LOCAL, res.target.hostType)
    }

    @Test
    fun resolve_discoveredLocalHealthy() {
        val res = ServerTargetResolver.resolve(
            Settings(serverUrl = ""),
            DiscoverySummary(found = true, baseUrl = "http://127.0.0.1:6767", health = HealthOutcome.OK),
        )
        res as TargetResolution.Resolved
        assertEquals("http://127.0.0.1:6767", res.target.baseUrl)
        assertEquals(HostType.LOCAL, res.target.hostType)
        assertEquals(ServerTarget.Source.DISCOVERED, res.target.source)
    }

    @Test
    fun resolve_localUnhealthyNeedsPrompt() {
        val res = ServerTargetResolver.resolve(
            Settings(serverUrl = ""),
            DiscoverySummary(found = true, baseUrl = "http://127.0.0.1:6767", health = HealthOutcome.TIMEOUT),
        )
        res as TargetResolution.NeedsPrompt
        assertEquals("local-unhealthy", res.reason)
    }

    @Test
    fun resolve_noManualNoLocalNeedsPrompt() {
        val res = ServerTargetResolver.resolve(Settings(serverUrl = ""), DiscoverySummary(found = false))
        res as TargetResolution.NeedsPrompt
        assertEquals("no-manual-no-local", res.reason)
    }

    @Test
    fun originOf_stripsPathAndKeepsPort() {
        assertEquals("http://127.0.0.1:6767", ServerTargetResolver.originOf("http://127.0.0.1:6767/c/abc"))
        assertEquals("https://omnigent.example.com", ServerTargetResolver.originOf("https://omnigent.example.com/x"))
    }

    // ── status labels ──────────────────────────────────────────────────────────
    @Test
    fun statusLabel_includesStateAndHost() {
        val label = StatusLabels.label(SessionStateService.ConnectionStatus.CONNECTED, HostType.LOCAL)
        assertEquals("Omnigent — Connected (local)", label)
    }

    @Test
    fun statusTooltip_includesSession() {
        val t = StatusLabels.tooltip(SessionStateService.ConnectionStatus.CONNECTED, HostType.REMOTE, "sess-9")
        assertTrue(t.contains("remote"))
        assertTrue(t.contains("sess-9"))
    }

    // ── redact ───────────────────────────────────────────────────────────────
    @Test
    fun redact_neverEmitsSecret() {
        assertEquals("<redacted>", Redact.redact("super-secret-jwt"))
        assertEquals("<none>", Redact.redact(null))
        assertEquals("<none>", Redact.redact(""))
    }

    @Test
    fun redactBearer_masksToken() {
        assertEquals("Authorization: Bearer <redacted>", Redact.redactBearer("Authorization: Bearer abc.def.ghi"))
    }

    @Test
    fun redactObject_masksSensitiveKeys() {
        val out = Redact.redactObject(mapOf("token" to "x", "url" to "http://h"))
        assertEquals("<redacted>", out["token"])
        assertEquals("http://h", out["url"])
    }
}

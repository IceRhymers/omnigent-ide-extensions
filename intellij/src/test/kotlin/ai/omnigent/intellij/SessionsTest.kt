package ai.omnigent.intellij

import ai.omnigent.intellij.api.ApiResponse
import ai.omnigent.intellij.api.ClientOptions
import ai.omnigent.intellij.api.OmnigentApiClient
import ai.omnigent.intellij.api.Session
import ai.omnigent.intellij.api.SessionsPage
import ai.omnigent.intellij.api.parseSessionsPage
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Unit tests for the Session model parse + the listSessions cap loop (Phase 1). */
class SessionsTest {

    private val client = OmnigentApiClient(ClientOptions(baseUrl = "http://127.0.0.1:6767"))

    /** Build a page from session ids plus cursor/has_more fields. */
    private fun page(ids: List<String>, hasMore: Boolean? = null, lastId: String? = null): SessionsPage =
        SessionsPage(
            `object` = "list",
            data = ids.map { Session(id = it) },
            lastId = lastId,
            hasMore = hasMore,
        )

    // ── parseSessionsPage round-trip + disambiguation ──────────────────────────
    @Test
    fun parseSessionsPage_roundTripsFullEnvelope() {
        val raw = """
            {"object":"list","first_id":"a","last_id":"b","has_more":true,
             "data":[{"id":"a","agent_id":"ag_1","agent_name":"Coder","status":"running",
                      "created_at":1700000000,"updated_at":1700000100,"title":"Fix the bug",
                      "workspace":"/abs/path","git_branch":"feat/x","archived":true}]}
        """.trimIndent()
        val pageOut = parseSessionsPage(raw)
        assertEquals("list", pageOut.`object`)
        assertEquals("a", pageOut.firstId)
        assertEquals("b", pageOut.lastId)
        assertEquals(true, pageOut.hasMore)
        assertEquals(1, pageOut.data.size)
        val s = pageOut.data[0]
        assertEquals("a", s.id)
        assertEquals("ag_1", s.agentId)
        assertEquals("Coder", s.agentName)
        assertEquals("running", s.status)
        assertEquals(1700000000L, s.createdAt)
        assertEquals(1700000100L, s.updatedAt)
        assertEquals("Fix the bug", s.title)
        assertEquals("/abs/path", s.workspace)
        assertEquals("feat/x", s.gitBranch)
        assertEquals(true, s.archived)
    }

    @Test
    fun parseSessionsPage_absentOptionalFieldsDecodeToNull() {
        val pageOut = parseSessionsPage("""{"object":"list","data":[{"id":"conv_2"}]}""")
        val s = pageOut.data[0]
        assertEquals("conv_2", s.id)
        assertNull(s.title)
        assertNull(s.archived)
        assertNull(s.updatedAt)
        assertNull(s.agentName)
        // absent cursor fields default to null / has_more null
        assertNull(pageOut.lastId)
        assertNull(pageOut.hasMore)
    }

    @Test
    fun parseSessionsPage_explicitNullDecodesToNull() {
        val pageOut = parseSessionsPage(
            """{"object":"list","last_id":null,"has_more":null,
                "data":[{"id":"c","title":null,"workspace":null,"git_branch":null}]}""",
        )
        val s = pageOut.data[0]
        assertNull(s.title)
        assertNull(s.workspace)
        assertNull(s.gitBranch)
        assertNull(pageOut.lastId)
        assertNull(pageOut.hasMore)
    }

    @Test
    fun parseSessionsPage_emptyStringPreserved() {
        val pageOut = parseSessionsPage(
            """{"object":"list","data":[{"id":"d","title":"","git_branch":""}]}""",
        )
        val s = pageOut.data[0]
        assertEquals("", s.title)
        assertEquals("", s.gitBranch)
    }

    @Test
    fun parseSessionsPage_malformedIsEmptyPage() {
        val pageOut = parseSessionsPage("not json")
        assertTrue(pageOut.data.isEmpty())
        assertNull(pageOut.hasMore)
    }

    @Test
    fun parseSessionsPage_unknownKeysIgnored() {
        val pageOut = parseSessionsPage(
            """{"object":"list","data":[{"id":"e","labels":{"k":"v"},"comments_count":3}]}""",
        )
        assertEquals("e", pageOut.data[0].id)
    }

    // ── listSessions cap loop: three stop conditions + truncated flag ──────────
    @Test
    fun listSessions_followsCursorAndAccumulates() {
        val responses = listOf(
            page(listOf("a", "b"), hasMore = true, lastId = "b"),
            page(listOf("c"), hasMore = false, lastId = "c"),
        )
        val seenAfters = mutableListOf<String?>()
        var i = 0
        val res = client.listSessions(cap = 200) { after ->
            seenAfters.add(after)
            ApiResponse(true, 200, responses[i++])
        }
        assertTrue(res.ok)
        assertEquals(listOf("a", "b", "c"), res.data!!.sessions.map { it.id })
        assertFalse(res.data!!.truncated)
        // first call after=null, second call follows the cursor
        assertEquals(listOf(null, "b"), seenAfters)
    }

    @Test
    fun listSessions_stopsWhenHasMoreNotTrue() {
        var calls = 0
        val res = client.listSessions(cap = 200) { _ ->
            calls++
            ApiResponse(true, 200, page(listOf("a", "b"), hasMore = false, lastId = "b"))
        }
        assertEquals(1, calls)
        assertEquals(listOf("a", "b"), res.data!!.sessions.map { it.id })
        assertFalse(res.data!!.truncated)
    }

    @Test
    fun listSessions_stopsWhenNextCursorBlank() {
        var calls = 0
        val res = client.listSessions(cap = 200) { _ ->
            calls++
            // has_more=true but no usable next cursor -> must stop.
            ApiResponse(true, 200, page(listOf("a"), hasMore = true, lastId = null))
        }
        assertEquals(1, calls)
        assertEquals(listOf("a"), res.data!!.sessions.map { it.id })
        // size (1) < cap (200) so not truncated even though hasMore was true
        assertFalse(res.data!!.truncated)
    }

    @Test
    fun listSessions_stopsAtCapWithHasMoreTrue_isTruncated() {
        var calls = 0
        val res = client.listSessions(cap = 2) { _ ->
            calls++
            ApiResponse(true, 200, page(listOf("a", "b"), hasMore = true, lastId = "b"))
        }
        // total (2) >= cap (2) -> stops after one page, never follows the cursor.
        assertEquals(1, calls)
        assertEquals(listOf("a", "b"), res.data!!.sessions.map { it.id })
        assertTrue(res.data!!.truncated)
    }

    @Test
    fun listSessions_exactlyAtCapWithHasMoreFalse_notTruncated() {
        val res = client.listSessions(cap = 2) { _ ->
            ApiResponse(true, 200, page(listOf("a", "b"), hasMore = false, lastId = "b"))
        }
        assertEquals(listOf("a", "b"), res.data!!.sessions.map { it.id })
        // boundary: exactly at cap but the last page reports has_more=false -> NOT truncated
        assertFalse(res.data!!.truncated)
    }

    @Test
    fun listSessions_capTrimsExcessFromPage() {
        val res = client.listSessions(cap = 2) { _ ->
            ApiResponse(true, 200, page(listOf("a", "b", "c"), hasMore = true, lastId = "c"))
        }
        // only the first cap sessions are kept; has_more=true && size>=cap -> truncated
        assertEquals(listOf("a", "b"), res.data!!.sessions.map { it.id })
        assertTrue(res.data!!.truncated)
    }

    @Test
    fun listSessions_propagatesNonOkPageImmediately() {
        var calls = 0
        val res = client.listSessions(cap = 200) { _ ->
            calls++
            ApiResponse(false, 401, null, "reauth")
        }
        assertEquals(1, calls)
        assertFalse(res.ok)
        assertEquals(401, res.status)
        assertEquals("reauth", res.error)
        assertNull(res.data)
    }

    @Test
    fun listSessions_accumulatesMultiplePagesUpToCap() {
        val responses = listOf(
            page(listOf("a", "b"), hasMore = true, lastId = "b"),
            page(listOf("c", "d"), hasMore = true, lastId = "d"),
            page(listOf("e"), hasMore = false, lastId = "e"),
        )
        var i = 0
        val res = client.listSessions(cap = 200) { _ -> ApiResponse(true, 200, responses[i++]) }
        assertEquals(listOf("a", "b", "c", "d", "e"), res.data!!.sessions.map { it.id })
        assertFalse(res.data!!.truncated)
    }
}

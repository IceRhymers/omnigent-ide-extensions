package ai.omnigent.intellij.api

import ai.omnigent.intellij.auth.HttpAuthOutcome
import ai.omnigent.intellij.auth.HttpStatus
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets

/**
 * Thin HTTP client for the Omnigent /v1 REST surface (B4).
 * Mirrors vscode/src/api/client.ts.
 *
 * Pure payload-construction / parse functions live in [OmnigentPayloads] and
 * are unit-tested in isolation; the actual HTTP calls go through
 * java.net.http.HttpClient. The pure pieces (buildMessageEvent,
 * parseDiffResponse, isChangedFilesEvent, parseSseChunk) carry the testable
 * logic so the IDE-touching parts stay thin.
 *
 * API surface (plan Lane 1 evidence):
 *   POST /v1/sessions                              — create session
 *   GET  /v1/sessions/{id}                         — snapshot
 *   POST /v1/sessions/{id}/events                  — send events (message/etc.)
 *   GET  /v1/sessions/{id}/stream                  — SSE stream
 *   GET  /v1/sessions/{id}/resources/files         — list changed files
 *   GET  /v1/sessions/{id}/resources/environments/{env}/diff/{path}
 */
data class ClientOptions(
    val baseUrl: String,
    /** Bearer token — null when no token is available. */
    val token: String? = null,
)

data class ApiResponse<T>(
    val ok: Boolean,
    val status: Int,
    val data: T? = null,
    val error: String? = null,
)

data class ChangedFile(
    val fileId: String,
    val relativePath: String,
    val environmentId: String? = null,
)

data class Agent(
    val id: String,
    val name: String,
    val description: String? = null,
)

data class DiffResult(
    val before: String,
    val after: String,
    val relativePath: String,
)

data class SseEvent(
    val event: String? = null,
    val data: String,
)

/** Pure, dependency-light payload + parse helpers (unit-tested). */
object OmnigentPayloads {
    private val json = Json { ignoreUnknownKeys = true }

    /** Build the Authorization header when a token is present. Pure. */
    fun buildAuthHeaders(token: String?): Map<String, String> =
        if (!token.isNullOrEmpty()) mapOf("Authorization" to "Bearer $token") else emptyMap()

    /** Build the `message` event payload for send-selection (B4). Pure. */
    fun buildMessageEvent(content: String, workspaceRelativePath: String? = null): JsonObject =
        buildJsonObject {
            put("type", "message")
            put("content", content)
            if (workspaceRelativePath != null) {
                put("context", buildJsonObject { put("file", workspaceRelativePath) })
            }
        }

    /** Parse the diff API response into a typed [DiffResult]. Pure. */
    fun parseDiffResponse(raw: JsonObject, relativePath: String): DiffResult =
        DiffResult(
            before = raw["before"]?.jsonPrimitive?.contentOrNull() ?: "",
            after = raw["after"]?.jsonPrimitive?.contentOrNull() ?: "",
            relativePath = relativePath,
        )

    /** Parse a changed-files list JSON array into typed records. Pure. */
    fun parseChangedFiles(rawBody: String): List<ChangedFile> {
        val arr = try {
            json.parseToJsonElement(rawBody).jsonArray
        } catch (_: Exception) {
            return emptyList()
        }
        return arr.mapNotNull { el ->
            val obj = el as? JsonObject ?: return@mapNotNull null
            val fileId = obj["file_id"]?.jsonPrimitive?.contentOrNull() ?: return@mapNotNull null
            val relativePath = obj["relative_path"]?.jsonPrimitive?.contentOrNull() ?: return@mapNotNull null
            ChangedFile(
                fileId = fileId,
                relativePath = relativePath,
                environmentId = obj["environment_id"]?.jsonPrimitive?.contentOrNull(),
            )
        }
    }

    /** Parse an agents list JSON array into typed records. Pure. */
    fun parseAgents(rawBody: String): List<Agent> {
        val arr = try {
            json.parseToJsonElement(rawBody).jsonArray
        } catch (_: Exception) {
            return emptyList()
        }
        return arr.mapNotNull { el ->
            val obj = el as? JsonObject ?: return@mapNotNull null
            val id = obj["id"]?.jsonPrimitive?.contentOrNull() ?: return@mapNotNull null
            val name = obj["name"]?.jsonPrimitive?.contentOrNull() ?: return@mapNotNull null
            Agent(
                id = id,
                name = name,
                description = obj["description"]?.jsonPrimitive?.contentOrNull(),
            )
        }
    }

    /** Build the create-session request body `{ "agent_id": ... }`. Pure. */
    fun buildCreateSessionBody(agentId: String): JsonObject =
        buildJsonObject { put("agent_id", agentId) }

    /** Extract the session id from a create-session JSON response body. Pure. */
    fun parseSessionId(rawBody: String): String? = try {
        (json.parseToJsonElement(rawBody) as? JsonObject)?.get("id")?.jsonPrimitive?.contentOrNull()
    } catch (_: Exception) {
        null
    }

    /** Check whether an SSE event signals changed-files invalidation. Pure. */
    fun isChangedFilesEvent(event: SseEvent): Boolean =
        event.event == "session.changed_files.invalidated"

    /**
     * Parse a raw SSE chunk into [SseEvent]s. Pure — no network IO; testable
     * with raw string input. Mirrors the TS parseSseChunk.
     */
    fun parseSseChunk(chunk: String): List<SseEvent> {
        val events = mutableListOf<SseEvent>()
        val blocks = chunk.split(Regex("\\n\\n+"))
        for (block in blocks) {
            if (block.isBlank()) continue
            var event: String? = null
            val data = StringBuilder()
            for (line in block.split("\n")) {
                when {
                    line.startsWith("event:") -> event = line.substring(6).trim()
                    line.startsWith("data:") -> data.append(line.substring(5).trim())
                }
            }
            if (data.isNotEmpty()) events.add(SseEvent(event, data.toString()))
        }
        return events
    }

    /** URL-encode each path segment (preserving slashes). Pure. */
    fun encodePath(relativePath: String): String =
        relativePath.split("/").joinToString("/") {
            URLEncoder.encode(it, StandardCharsets.UTF_8).replace("+", "%20")
        }

    private fun kotlinx.serialization.json.JsonPrimitive.contentOrNull(): String? =
        if (this is kotlinx.serialization.json.JsonNull) null else this.content
}

/**
 * Runtime HTTP client. The choke point [apiFetch] mirrors the TS apiFetch:
 * attaches the bearer, maps the HTTP status to an auth outcome, and returns a
 * typed [ApiResponse] of the parsed JSON body.
 */
class OmnigentApiClient(
    private val opts: ClientOptions,
    private val httpClient: HttpClient = HttpClient.newHttpClient(),
) {
    private val json = Json { ignoreUnknownKeys = true }

    private fun requestBuilder(path: String): HttpRequest.Builder {
        val url = opts.baseUrl.trimEnd('/') + path
        val builder = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .header("Accept", "application/json")
        OmnigentPayloads.buildAuthHeaders(opts.token).forEach { (k, v) -> builder.header(k, v) }
        return builder
    }

    /** Low-level authenticated request returning the raw body + status. */
    private fun execute(builder: HttpRequest.Builder): ApiResponse<String> {
        return try {
            val resp = httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofString())
            when (HttpStatus.map(resp.statusCode())) {
                HttpAuthOutcome.OK -> ApiResponse(true, resp.statusCode(), resp.body())
                else -> ApiResponse(false, resp.statusCode(), null, HttpStatus.map(resp.statusCode()).name.lowercase())
            }
        } catch (e: Exception) {
            ApiResponse(false, 0, null, e.message ?: e.toString())
        }
    }

    fun listAgents(): ApiResponse<List<Agent>> {
        val resp = execute(requestBuilder("/v1/agents").GET())
        return if (resp.ok) ApiResponse(true, resp.status, OmnigentPayloads.parseAgents(resp.data ?: ""))
        else ApiResponse(false, resp.status, null, resp.error)
    }

    fun createSession(agentId: String): ApiResponse<String> {
        val body = OmnigentPayloads.buildCreateSessionBody(agentId)
        val builder = requestBuilder("/v1/sessions")
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
        val resp = execute(builder)
        return if (resp.ok) ApiResponse(true, resp.status, OmnigentPayloads.parseSessionId(resp.data ?: ""))
        else ApiResponse(false, resp.status, null, resp.error)
    }

    fun postSessionEvent(sessionId: String, event: JsonObject): ApiResponse<Unit> {
        val builder = requestBuilder("/v1/sessions/$sessionId/events")
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(event.toString()))
        val resp = execute(builder)
        return ApiResponse(resp.ok, resp.status, if (resp.ok) Unit else null, resp.error)
    }

    fun listChangedFiles(sessionId: String): ApiResponse<List<ChangedFile>> {
        val resp = execute(requestBuilder("/v1/sessions/$sessionId/resources/files").GET())
        return if (resp.ok) ApiResponse(true, resp.status, OmnigentPayloads.parseChangedFiles(resp.data ?: ""))
        else ApiResponse(false, resp.status, null, resp.error)
    }

    /**
     * Fetch a single page of sessions. `limit`/`after` are appended as query
     * params only when non-null (mirrors the TS listSessionsPage).
     */
    fun listSessionsPage(opts: ListSessionsOptions = ListSessionsOptions()): ApiResponse<SessionsPage> {
        val params = mutableListOf<String>()
        opts.limit?.let { params.add("limit=${URLEncoder.encode(it.toString(), StandardCharsets.UTF_8)}") }
        opts.after?.let { params.add("after=${URLEncoder.encode(it, StandardCharsets.UTF_8)}") }
        val query = if (params.isEmpty()) "" else "?" + params.joinToString("&")
        val resp = execute(requestBuilder("/v1/sessions$query").GET())
        return if (resp.ok) ApiResponse(true, resp.status, parseSessionsPage(resp.data ?: ""))
        else ApiResponse(false, resp.status, null, resp.error)
    }

    /**
     * List sessions, following the `after = last_id` cursor while `has_more` is
     * true and the accumulated total is below [cap]. Non-ok pages (esp. 401/403)
     * propagate as-is without throwing so callers can map them to the
     * unauthorized/error states.
     *
     * The cap loop replicates the three TS stop conditions in order (client.ts:217):
     * break when (1) `hasMore != true`, OR (2) the next cursor (`lastId`) is
     * null/blank, OR (3) `total >= cap`; otherwise set `after = lastId` and continue.
     *
     * `truncated` follows the `accumulateSessions` semantics (client.ts:166-181):
     * `lastHasMore && sessions.size >= cap`, where `lastHasMore` is the `has_more`
     * of the LAST consumed page and `sessions.size` is the accumulated capped total.
     *
     * [fetchPage] is injectable for testing the loop without real HTTP.
     */
    fun listSessions(
        cap: Int = 200,
        fetchPage: (after: String?) -> ApiResponse<SessionsPage> = { after ->
            listSessionsPage(ListSessionsOptions(after = after))
        },
    ): ApiResponse<SessionsResult> {
        val pages = mutableListOf<SessionsPage>()
        var after: String? = null
        var lastStatus = 200
        while (true) {
            val res = fetchPage(after)
            if (!res.ok || res.data == null) {
                return ApiResponse(res.ok, res.status, null, res.error)
            }
            lastStatus = res.status
            pages.add(res.data)
            val total = pages.sumOf { it.data.size }
            val next = res.data.lastId
            if (res.data.hasMore != true || next.isNullOrBlank() || total >= cap) break
            after = next
        }

        val sessions = mutableListOf<Session>()
        var lastHasMore = false
        for (page in pages) {
            lastHasMore = page.hasMore == true
            for (s in page.data) {
                if (sessions.size >= cap) break
                sessions.add(s)
            }
            if (sessions.size >= cap) break
        }
        val truncated = lastHasMore && sessions.size >= cap
        return ApiResponse(true, lastStatus, SessionsResult(sessions.toList(), truncated))
    }

    fun fetchDiff(sessionId: String, environmentId: String, relativePath: String): ApiResponse<DiffResult> {
        val encoded = OmnigentPayloads.encodePath(relativePath)
        val resp = execute(
            requestBuilder("/v1/sessions/$sessionId/resources/environments/$environmentId/diff/$encoded").GET(),
        )
        if (!resp.ok || resp.data == null) return ApiResponse(false, resp.status, null, resp.error)
        return try {
            val obj = json.parseToJsonElement(resp.data).jsonObject
            ApiResponse(true, resp.status, OmnigentPayloads.parseDiffResponse(obj, relativePath))
        } catch (e: Exception) {
            ApiResponse(false, resp.status, null, e.message)
        }
    }
}

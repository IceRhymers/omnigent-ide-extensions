package ai.omnigent.intellij.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Session model + list-sessions parse helpers.
 * Mirrors the TS shape in vscode/src/api/client.ts (Session / SessionsPage /
 * ListSessionsOptions / accumulateSessions / listSessions).
 *
 * Pure parse logic lives in [parseSessionsPage] (OmnigentPayloads style); the
 * cap-following list loop in [OmnigentApiClient.listSessions] replicates the
 * three TS stop conditions and the `accumulateSessions` `truncated` definition.
 */

/**
 * A session as returned by `GET /v1/sessions` (pinned from a live capture).
 * Timestamps are unix SECONDS; `title`/`workspace`/`gitBranch` are OPTIONAL and
 * absent on some sessions; `archived` is a BOOLEAN (not a status value).
 *
 * Nullable fields default to null so absent JSON keys decode cleanly under
 * `ignoreUnknownKeys = true`. An explicit JSON null also decodes to null; an
 * empty string decodes to "" (disambiguated by [parseSessionsPage]).
 */
@Serializable
data class Session(
    val id: String,
    @SerialName("agent_id") val agentId: String? = null,
    @SerialName("agent_name") val agentName: String? = null,
    val status: String? = null, // open string enum: "running" | "idle" | ...
    @SerialName("created_at") val createdAt: Long? = null, // unix SECONDS
    @SerialName("updated_at") val updatedAt: Long? = null, // unix SECONDS
    val title: String? = null,
    val workspace: String? = null, // abs path
    @SerialName("git_branch") val gitBranch: String? = null,
    val archived: Boolean? = null,
)

/** One page of the OpenAI-style cursor-paginated `GET /v1/sessions` response. */
@Serializable
data class SessionsPage(
    val `object`: String? = null,
    val data: List<Session> = emptyList(),
    @SerialName("first_id") val firstId: String? = null,
    @SerialName("last_id") val lastId: String? = null,
    @SerialName("has_more") val hasMore: Boolean? = null,
)

/** Query options for a single `GET /v1/sessions` page. */
data class ListSessionsOptions(
    val limit: Int? = null,
    val after: String? = null,
)

/**
 * Result of the cap-following [OmnigentApiClient.listSessions] loop.
 * `truncated` follows the `accumulateSessions` definition: the last consumed
 * page still reported `has_more` AND the accumulated total reached the cap.
 */
data class SessionsResult(
    val sessions: List<Session>,
    val truncated: Boolean,
)

private val sessionsJson = Json { ignoreUnknownKeys = true }

/**
 * Parse the `GET /v1/sessions` page envelope. Pure — raw body in, typed page out.
 *
 * Disambiguates absent / explicit-null / empty-string for the optional fields:
 * absent keys and explicit JSON nulls both decode to null (kotlinx default);
 * empty strings decode to "" (preserved, not coerced to null). Malformed bodies
 * yield an empty page rather than throwing.
 */
fun parseSessionsPage(rawBody: String): SessionsPage = try {
    sessionsJson.decodeFromString(SessionsPage.serializer(), rawBody)
} catch (_: Exception) {
    SessionsPage()
}

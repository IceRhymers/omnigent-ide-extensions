package ai.omnigent.intellij.auth

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/**
 * Token resolution from ~/.omnigent/auth_tokens.json (contract §3).
 * Mirrors vscode/src/auth/tokens.ts.
 *
 * The file is a JSON object keyed by origin. Two record shapes:
 *  - normal bearer:      { token, user_id, expires_at }
 *  - databricks pointer: { auth_type: "databricks", workspace_host }  (no token)
 *
 * Pure resolution here; filesystem read lives in [AuthService].
 * Conformance: docs/conformance/auth-tokens.json.
 */
sealed interface FileResolution {
    val origin: String

    data class Bearer(
        override val origin: String,
        val token: String,
        val userId: String? = null,
        val expiresAt: Long? = null,
    ) : FileResolution

    data class DatabricksPointer(
        override val origin: String,
        val workspaceHost: String,
    ) : FileResolution

    data class None(override val origin: String) : FileResolution
}

object Tokens {
    /**
     * Resolve the record for an exact origin match. Pure.
     * [store] is the parsed token file: origin -> record JSON object.
     */
    fun resolveTokenForOrigin(store: Map<String, JsonObject>, origin: String): FileResolution {
        val rec = store[origin] ?: return FileResolution.None(origin)

        val authType = rec["auth_type"]?.jsonPrimitive?.content
        val workspaceHost = rec["workspace_host"]?.jsonPrimitive?.content
        if (authType == "databricks" && workspaceHost != null) {
            return FileResolution.DatabricksPointer(origin, workspaceHost)
        }

        val token = rec["token"]?.jsonPrimitive?.content
        if (token != null) {
            return FileResolution.Bearer(
                origin = origin,
                token = token,
                userId = rec["user_id"]?.jsonPrimitive?.content,
                expiresAt = rec["expires_at"]?.jsonPrimitive?.longOrNull,
            )
        }

        return FileResolution.None(origin)
    }

    /** Parse the raw auth_tokens.json content into the origin->record map. */
    fun parseStore(raw: String): Map<String, JsonObject> {
        val json = Json { ignoreUnknownKeys = true }
        val root = json.parseToJsonElement(raw) as? JsonObject ?: return emptyMap()
        return root.mapNotNull { (key, value) ->
            (value as? JsonObject)?.let { key to it }
        }.toMap()
    }
}

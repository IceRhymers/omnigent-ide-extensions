package ai.omnigent.intellij.auth

/**
 * Token precedence (contract §3): manual setting > file bearer > databricks
 * pointer > none. Pure. Mirrors vscode/src/auth/precedence.ts.
 * Conformance: docs/conformance/token-precedence.json.
 */
sealed interface ResolvedToken {
    data class Manual(val token: String) : ResolvedToken
    data class File(val token: String) : ResolvedToken
    data class DatabricksPointer(val workspaceHost: String) : ResolvedToken
    object None : ResolvedToken
}

object Precedence {
    /**
     * Apply precedence. [manualToken] is the `omnigent.token` setting (may be
     * null or empty). [fileResolution] is the result of
     * [Tokens.resolveTokenForOrigin].
     */
    fun resolve(manualToken: String?, fileResolution: FileResolution): ResolvedToken {
        if (!manualToken.isNullOrEmpty()) {
            return ResolvedToken.Manual(manualToken)
        }
        return when (fileResolution) {
            is FileResolution.Bearer -> ResolvedToken.File(fileResolution.token)
            is FileResolution.DatabricksPointer ->
                ResolvedToken.DatabricksPointer(fileResolution.workspaceHost)
            is FileResolution.None -> ResolvedToken.None
        }
    }

    /** Build the Authorization header for a resolved token, or null. */
    fun authHeader(resolved: ResolvedToken): Pair<String, String>? = when (resolved) {
        is ResolvedToken.Manual -> "Authorization" to "Bearer ${resolved.token}"
        is ResolvedToken.File -> "Authorization" to "Bearer ${resolved.token}"
        else -> null
    }

    /** The bearer token string for a resolved token, or null. */
    fun bearerToken(resolved: ResolvedToken): String? = when (resolved) {
        is ResolvedToken.Manual -> resolved.token
        is ResolvedToken.File -> resolved.token
        else -> null
    }
}

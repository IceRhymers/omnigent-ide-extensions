package ai.omnigent.intellij

/**
 * Secret-redaction helpers (contract §3 "Secret hygiene").
 *
 * The bearer token is a secret. It MUST NEVER appear in logs, diagnostics, or a
 * navigable URL. Anything that may carry a token is passed through [redact]
 * before it reaches a log/diagnostic sink. Mirrors vscode/src/redact.ts.
 */
object Redact {
    private const val REDACTED = "<redacted>"
    private const val NONE = "<none>"

    private val BEARER_RE = Regex("Bearer\\s+[A-Za-z0-9._~+/=-]+", RegexOption.IGNORE_CASE)
    private val SENSITIVE_KEY_RE = Regex("token|authorization|secret|password", RegexOption.IGNORE_CASE)

    /** Replace a present, non-empty secret with a fixed placeholder. */
    fun redact(secret: String?): String {
        if (secret.isNullOrEmpty()) return NONE
        return REDACTED
    }

    /** Redact a bearer token embedded inside an arbitrary string. */
    fun redactBearer(value: String): String = BEARER_RE.replace(value, "Bearer $REDACTED")

    /** Strip token/authorization/secret/password fields from a map for safe logging. */
    fun redactObject(obj: Map<String, Any?>): Map<String, Any?> =
        obj.mapValues { (key, value) ->
            if (SENSITIVE_KEY_RE.containsMatchIn(key)) redact(value?.toString()) else value
        }
}

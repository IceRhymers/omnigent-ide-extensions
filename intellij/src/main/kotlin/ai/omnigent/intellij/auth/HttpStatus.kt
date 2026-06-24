package ai.omnigent.intellij.auth

/**
 * One-shot HTTP status -> auth outcome (contract §5.2).
 * Mirrors vscode/src/auth/httpStatus.ts.
 * Conformance: docs/conformance/http-status.json.
 *
 * 401 => reauth (refresh/re-login then retry, or prompt)
 * 403 => forbidden (authenticated but not permitted; do NOT re-login loop)
 * 2xx => ok
 * other => error
 */
enum class HttpAuthOutcome { OK, REAUTH, FORBIDDEN, ERROR }

object HttpStatus {
    fun map(status: Int): HttpAuthOutcome = when {
        status in 200..299 -> HttpAuthOutcome.OK
        status == 401 -> HttpAuthOutcome.REAUTH
        status == 403 -> HttpAuthOutcome.FORBIDDEN
        else -> HttpAuthOutcome.ERROR
    }
}

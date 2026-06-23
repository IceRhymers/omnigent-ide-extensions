package ai.omnigent.intellij.auth

import kotlinx.serialization.json.JsonObject
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

/**
 * Auth foundation (B3): read ~/.omnigent/auth_tokens.json (0600), resolve the
 * token for an origin honoring precedence, and expose the Authorization header.
 * Mirrors vscode/src/auth/index.ts.
 *
 * Pure logic lives in [Tokens] / [Precedence] / [HttpStatus] / [Lifecycle];
 * this service wires the filesystem IO behind an injectable interface. The
 * token is a secret and is NEVER logged (use [ai.omnigent.intellij.Redact]).
 */
val AUTH_TOKENS_PATH: Path =
    Paths.get(System.getProperty("user.home"), ".omnigent", "auth_tokens.json")

/** Injectable IO so token resolution is testable without the real home dir. */
interface AuthIO {
    /** Returns the parsed origin->record map, or null if unreadable/missing. */
    fun readTokens(): Map<String, JsonObject>?
}

object DefaultAuthIO : AuthIO {
    override fun readTokens(): Map<String, JsonObject>? = try {
        val raw = Files.readString(AUTH_TOKENS_PATH)
        Tokens.parseStore(raw)
    } catch (_: Exception) {
        null
    }
}

data class TokenResolution(
    val resolved: ResolvedToken,
    val fileResolution: FileResolution,
)

object AuthService {
    /**
     * Resolve the effective token for an origin: read the file, match the
     * origin, then apply precedence against the manual setting. Never logs the
     * token.
     */
    fun resolveToken(
        origin: String,
        manualToken: String?,
        io: AuthIO = DefaultAuthIO,
    ): TokenResolution {
        val store = io.readTokens() ?: emptyMap()
        val fileResolution = Tokens.resolveTokenForOrigin(store, origin)
        val resolved = Precedence.resolve(manualToken, fileResolution)
        return TokenResolution(resolved, fileResolution)
    }

    /** Convenience: the Authorization header for an origin (or null). */
    fun resolveAuthHeader(
        origin: String,
        manualToken: String?,
        io: AuthIO = DefaultAuthIO,
    ): Pair<String, String>? = Precedence.authHeader(resolveToken(origin, manualToken, io).resolved)
}

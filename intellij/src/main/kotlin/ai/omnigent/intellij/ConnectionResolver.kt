package ai.omnigent.intellij

import ai.omnigent.intellij.api.ClientOptions
import ai.omnigent.intellij.auth.AuthService
import ai.omnigent.intellij.auth.Precedence
import ai.omnigent.intellij.config.DiscoverySummary
import ai.omnigent.intellij.config.ServerTarget
import ai.omnigent.intellij.config.ServerTargetResolver
import ai.omnigent.intellij.config.Settings
import ai.omnigent.intellij.config.TargetResolution
import ai.omnigent.intellij.discovery.Discovery
import ai.omnigent.intellij.discovery.LocalDiscovery

/**
 * Glue that resolves a usable connection (server target + client options) by
 * combining the pure config resolver, local discovery, and auth precedence.
 * Kept thin and side-effect-light so the IDE actions/tool window just call it.
 * The token is resolved here and passed into [ClientOptions]; it is NEVER
 * logged (callers redact via [Redact]).
 */
data class Connection(
    val target: ServerTarget,
    val clientOpts: ClientOptions,
)

object ConnectionResolver {
    /**
     * Resolve a connection from settings. Returns null when neither a manual
     * override nor a healthy local server is available (caller prompts).
     */
    fun resolve(settings: Settings): Connection? {
        val discovery: DiscoverySummary = when (val d = Discovery.discoverLocalServer()) {
            is LocalDiscovery.Found -> DiscoverySummary(true, d.baseUrl, d.health)
            is LocalDiscovery.NotFound -> DiscoverySummary(false)
        }

        val target = when (val res = ServerTargetResolver.resolve(settings, discovery)) {
            is TargetResolution.Resolved -> res.target
            is TargetResolution.NeedsPrompt -> return null
        }

        val resolvedToken = AuthService.resolveToken(target.origin, settings.token.ifBlank { null }).resolved
        val bearer = Precedence.bearerToken(resolvedToken)

        return Connection(target, ClientOptions(baseUrl = target.baseUrl, token = bearer))
    }
}

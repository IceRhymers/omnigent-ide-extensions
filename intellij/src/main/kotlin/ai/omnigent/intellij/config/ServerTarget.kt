package ai.omnigent.intellij.config

import ai.omnigent.intellij.discovery.HealthOutcome
import java.net.URI

/**
 * Config + server-target + host-type resolution (B3 / contract §4).
 * Mirrors vscode/src/config/index.ts.
 *
 * Resolution order: manual override (serverUrl set) > auto-discovered local >
 * (caller prompts). All decision logic is pure and isolated from the IntelliJ
 * API behind the [Settings] data so it is unit-testable without an IDE host.
 * The thin IDE settings adapter lives in OmnigentSettings.kt.
 */
enum class HostType { LOCAL, REMOTE, UNKNOWN }

data class ServerTarget(
    val baseUrl: String,
    val origin: String,
    val hostType: HostType,
    /** Where the target came from, for redacted diagnostics. */
    val source: Source,
) {
    enum class Source { MANUAL, DISCOVERED }
}

/** Plain settings snapshot (isolates the IntelliJ settings service). */
data class Settings(
    val serverUrl: String = "",
    val token: String = "",
)

/** The discovery summary the resolver needs (kept abstract for testability). */
data class DiscoverySummary(
    val found: Boolean,
    val baseUrl: String? = null,
    val health: HealthOutcome? = null,
)

sealed interface TargetResolution {
    data class Resolved(val target: ServerTarget) : TargetResolution
    data class NeedsPrompt(val reason: String) : TargetResolution // no-manual-no-local | local-unhealthy
}

object ServerTargetResolver {
    private val LOOPBACK_HOSTS = setOf("localhost", "127.0.0.1", "::1", "[::1]")

    /** Derive the origin (scheme://host[:port]) from a URL. Pure. */
    fun originOf(url: String): String {
        val u = URI(url)
        val port = u.port
        val portPart = if (port == -1) "" else ":$port"
        return "${u.scheme}://${u.host}$portPart"
    }

    /** Classify a URL's host as local (loopback) or remote. Pure. */
    fun hostTypeOf(url: String): HostType = try {
        val host = URI(url).host
        if (host != null && LOOPBACK_HOSTS.contains(host)) HostType.LOCAL else HostType.REMOTE
    } catch (_: Exception) {
        HostType.UNKNOWN
    }

    /** Build a ServerTarget from a manual override URL. Pure. */
    fun manualTarget(serverUrl: String): ServerTarget {
        val trimmed = serverUrl.trimEnd('/')
        return ServerTarget(
            baseUrl = trimmed,
            origin = originOf(trimmed),
            hostType = hostTypeOf(trimmed),
            source = ServerTarget.Source.MANUAL,
        )
    }

    /** Build a ServerTarget from a discovered local baseUrl. Pure. */
    fun discoveredTarget(baseUrl: String): ServerTarget =
        ServerTarget(
            baseUrl = baseUrl,
            origin = originOf(baseUrl),
            hostType = HostType.LOCAL,
            source = ServerTarget.Source.DISCOVERED,
        )

    /**
     * Resolve a server target purely from settings + a discovery summary.
     *  1. manual override (serverUrl non-blank) wins
     *  2. else auto-discovered local with health == OK
     *  3. else needs-prompt
     */
    fun resolve(settings: Settings, discovery: DiscoverySummary): TargetResolution {
        if (settings.serverUrl.isNotBlank()) {
            return TargetResolution.Resolved(manualTarget(settings.serverUrl.trim()))
        }
        if (discovery.found && discovery.baseUrl != null) {
            return if (discovery.health == HealthOutcome.OK) {
                TargetResolution.Resolved(discoveredTarget(discovery.baseUrl))
            } else {
                TargetResolution.NeedsPrompt("local-unhealthy")
            }
        }
        return TargetResolution.NeedsPrompt("no-manual-no-local")
    }
}

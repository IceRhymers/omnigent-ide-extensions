package ai.omnigent.intellij.discovery

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.time.Duration

/**
 * Local-server discovery (B3 / contract §1, §2): read
 * ~/.omnigent/local_server.pid, parse it, confirm liveness, and probe /health.
 * The pure logic lives in [Pidfile] / [Health]; this module wires the
 * filesystem + network IO behind an injectable [DiscoveryIO] so it can be
 * exercised without touching the real home directory or network.
 * Mirrors vscode/src/discovery/index.ts.
 */

val PIDFILE_PATH: Path =
    Paths.get(System.getProperty("user.home"), ".omnigent", "local_server.pid")

/** Injectable IO surface so discovery is testable without real fs/net/os. */
interface DiscoveryIO {
    fun readPidfile(): String?
    fun isPidAlive(pid: Int): Boolean
    fun probeHealth(base: String, timeoutMs: Long): HealthOutcome
}

sealed interface LocalDiscovery {
    data class NotFound(val reason: String) : LocalDiscovery // no-pidfile | malformed | dead
    data class Found(
        val baseUrl: String,
        val pid: Int,
        val port: Int,
        val health: HealthOutcome,
    ) : LocalDiscovery
}

object Discovery {
    /**
     * Attempt to discover a usable local server. Returns the parsed/probed
     * result; the caller decides whether `health == OK` is required (it is, per
     * §2/§4).
     */
    fun discoverLocalServer(
        io: DiscoveryIO = DefaultDiscoveryIO,
        timeoutMs: Long = DEFAULT_HEALTH_TIMEOUT_MS,
    ): LocalDiscovery {
        val content = io.readPidfile() ?: return LocalDiscovery.NotFound("no-pidfile")

        // First parse with pidAlive=false purely to classify malformed vs structurally-valid.
        when (Pidfile.parse(content, false)) {
            is PidfileResult.Malformed -> return LocalDiscovery.NotFound("malformed")
            else -> { /* structurally valid; continue */ }
        }

        // Re-parse with the real liveness observation.
        val structural = Pidfile.parse(content, false)
        val pid = when (structural) {
            is PidfileResult.Dead -> structural.pid
            is PidfileResult.Ok -> structural.pid
            is PidfileResult.Malformed -> return LocalDiscovery.NotFound("malformed")
        }
        val alive = io.isPidAlive(pid)
        val result = Pidfile.parse(content, alive)
        if (result !is PidfileResult.Ok) {
            return LocalDiscovery.NotFound("dead")
        }

        val health = io.probeHealth(result.baseUrl, timeoutMs)
        return LocalDiscovery.Found(result.baseUrl, result.pid, result.port, health)
    }
}

/** Default IO backed by the real filesystem / OS / network (java.net.http). */
object DefaultDiscoveryIO : DiscoveryIO {
    private val json = Json { ignoreUnknownKeys = true }

    override fun readPidfile(): String? = try {
        Files.readString(PIDFILE_PATH)
    } catch (_: Exception) {
        null
    }

    override fun isPidAlive(pid: Int): Boolean = Liveness.isPidAlive(pid)

    /**
     * Runtime probe: GET {base}/health with a short timeout, reduced to a pure
     * [HealthObservation] that is then interpreted. Kept thin so the testable
     * surface is [Health.interpret].
     */
    override fun probeHealth(base: String, timeoutMs: Long): HealthOutcome {
        val url = base.trimEnd('/') + "/health"
        val client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofMillis(timeoutMs))
            .build()
        val request = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .timeout(Duration.ofMillis(timeoutMs))
            .GET()
            .build()
        return try {
            val resp = client.send(request, HttpResponse.BodyHandlers.ofString())
            val bodyStatusOk = parseStatusOk(resp.body())
            Health.interpret(HealthObservation(status = resp.statusCode(), bodyStatusOk = bodyStatusOk))
        } catch (e: java.net.http.HttpTimeoutException) {
            Health.interpret(HealthObservation(timedOut = true))
        } catch (e: Exception) {
            Health.interpret(HealthObservation(networkError = true))
        }
    }

    private fun parseStatusOk(body: String?): Boolean {
        if (body.isNullOrBlank()) return false
        return try {
            val obj = json.parseToJsonElement(body) as? JsonObject ?: return false
            obj["status"]?.jsonPrimitive?.content == "ok"
        } catch (_: Exception) {
            false
        }
    }
}

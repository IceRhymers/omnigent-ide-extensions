package ai.omnigent.intellij.discovery

/**
 * Pure /health-probe result interpretation (contract §2).
 * Mirrors vscode/src/discovery/health.ts.
 *
 * The probe's IO is abstracted into a [HealthObservation] so this logic runs
 * against docs/conformance/health.json without real network access. The runtime
 * fetch + 2000ms timeout live in the runtime probe (see [HealthProbe]).
 */
const val DEFAULT_HEALTH_TIMEOUT_MS = 2000L

/**
 * Abstract probe observation. `status`/`body` present on a real response;
 * `timedOut`/`networkError` flag the failure modes. `bodyStatusOk` is the
 * already-extracted truth of `body.status == "ok"` so this layer needs no JSON
 * dependency (the vectors supply `body` and we precompute the flag in the test
 * loader / runtime probe).
 */
data class HealthObservation(
    val status: Int? = null,
    val bodyStatusOk: Boolean = false,
    val timedOut: Boolean = false,
    val networkError: Boolean = false,
)

enum class HealthOutcome { OK, UNHEALTHY, TIMEOUT, UNREACHABLE }

object Health {
    /** Interpret a probe observation into an outcome. Pure. */
    fun interpret(obs: HealthObservation): HealthOutcome {
        if (obs.timedOut) return HealthOutcome.TIMEOUT
        if (obs.networkError) return HealthOutcome.UNREACHABLE
        if (obs.status == 200 && obs.bodyStatusOk) return HealthOutcome.OK
        return HealthOutcome.UNHEALTHY
    }
}

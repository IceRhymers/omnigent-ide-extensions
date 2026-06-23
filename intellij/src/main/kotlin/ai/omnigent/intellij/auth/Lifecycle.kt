package ai.omnigent.intellij.auth

/**
 * Long-lived (SSE/WS) auth lifecycle state machine (contract §5.3).
 * Mirrors vscode/src/auth/lifecycle.ts.
 *
 * This is the documented, testable INTERFACE for recovering a long-lived
 * connection on token expiry. The actual transport wiring (attaching it to a
 * live SSE/WS) is the IDE-side concern (B2/B4) and is intentionally NOT
 * implemented here. Conformance: docs/conformance/auth-lifecycle.json.
 */
enum class LifecycleState {
    CONNECTED, FAILED, REFRESHING, RECONNECTING, RESUMED, PROMPT_RELOGIN, CLOSED
}

sealed interface LifecycleEvent {
    data class AuthFailure(val code: Int) : LifecycleEvent
    object BeginRefresh : LifecycleEvent
    data class RefreshResult(val ok: Boolean) : LifecycleEvent
    data class ReconnectResult(val ok: Boolean) : LifecycleEvent
    object Teardown : LifecycleEvent
}

object Lifecycle {
    /** Pure transition function. Unknown (event, state) pairs are no-ops. */
    fun transition(state: LifecycleState, event: LifecycleEvent): LifecycleState {
        if (event is LifecycleEvent.Teardown) {
            return LifecycleState.CLOSED
        }

        return when (state) {
            LifecycleState.CONNECTED ->
                if (event is LifecycleEvent.AuthFailure) {
                    // 403 (forbidden) never auto-refreshes; go straight to re-login.
                    if (event.code == 403) LifecycleState.PROMPT_RELOGIN else LifecycleState.FAILED
                } else state

            LifecycleState.FAILED ->
                if (event is LifecycleEvent.BeginRefresh) LifecycleState.REFRESHING else state

            LifecycleState.REFRESHING ->
                if (event is LifecycleEvent.RefreshResult)
                    if (event.ok) LifecycleState.RECONNECTING else LifecycleState.PROMPT_RELOGIN
                else state

            LifecycleState.RECONNECTING ->
                if (event is LifecycleEvent.ReconnectResult)
                    if (event.ok) LifecycleState.RESUMED else LifecycleState.PROMPT_RELOGIN
                else state

            else -> state
        }
    }
}

/**
 * The lifecycle hooks a transport implementation (B2/B4) will supply. Declared
 * here so the contract is explicit; not wired to any live transport yet.
 */
interface AuthLifecycleHandlers {
    /** Invoked when the long-lived connection observes an auth failure. */
    fun onAuthFailure(code: Int)

    /** Attempt to refresh the token via the established auth path. */
    fun refresh(): Boolean

    /** Re-establish the transport with the refreshed token. */
    fun reconnect(): Boolean

    /** Tear down the transport cleanly (panel close / session switch). */
    fun teardown()
}

/**
 * Drives the state machine using the supplied handlers. Pure-ish orchestrator
 * over [Lifecycle.transition]; returns the terminal state. B2/B4 will attach
 * real handlers; tests use stubs.
 */
fun runRecovery(
    refresh: () -> Boolean,
    reconnect: () -> Boolean,
    failureCode: Int,
): LifecycleState {
    var state = Lifecycle.transition(
        LifecycleState.CONNECTED,
        LifecycleEvent.AuthFailure(failureCode),
    )
    if (state == LifecycleState.PROMPT_RELOGIN) return state // 403

    state = Lifecycle.transition(state, LifecycleEvent.BeginRefresh)
    val refreshed = refresh()
    state = Lifecycle.transition(state, LifecycleEvent.RefreshResult(refreshed))
    if (state == LifecycleState.PROMPT_RELOGIN) return state

    val reconnected = reconnect()
    state = Lifecycle.transition(state, LifecycleEvent.ReconnectResult(reconnected))
    return state
}

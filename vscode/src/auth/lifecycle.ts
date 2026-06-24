/**
 * Long-lived (SSE/WS) auth lifecycle state machine (contract §5.3).
 *
 * This is the documented, testable INTERFACE for recovering a long-lived
 * connection on token expiry. The actual transport wiring (attaching it to a
 * live SSE/WS) is A5/A6 and is intentionally NOT implemented here.
 *
 * Conformance: docs/conformance/auth-lifecycle.json.
 */

export type LifecycleState =
  | "connected"
  | "failed"
  | "refreshing"
  | "reconnecting"
  | "resumed"
  | "prompt-relogin"
  | "closed";

export type LifecycleEvent =
  | { type: "auth-failure"; code: number }
  | { type: "begin-refresh" }
  | { type: "refresh-result"; ok: boolean }
  | { type: "reconnect-result"; ok: boolean }
  | { type: "teardown" };

/** Pure transition function. Unknown (event, state) pairs are no-ops. */
export function transition(state: LifecycleState, event: LifecycleEvent): LifecycleState {
  if (event.type === "teardown") {
    return "closed";
  }

  switch (state) {
    case "connected":
      if (event.type === "auth-failure") {
        // 403 (forbidden) never auto-refreshes; go straight to re-login.
        return event.code === 403 ? "prompt-relogin" : "failed";
      }
      return state;

    case "failed":
      if (event.type === "begin-refresh") {
        return "refreshing";
      }
      return state;

    case "refreshing":
      if (event.type === "refresh-result") {
        return event.ok ? "reconnecting" : "prompt-relogin";
      }
      return state;

    case "reconnecting":
      if (event.type === "reconnect-result") {
        return event.ok ? "resumed" : "prompt-relogin";
      }
      return state;

    default:
      return state;
  }
}

/**
 * The lifecycle hooks a transport implementation (A5/A6) will supply. Declared
 * here so the contract is explicit; not wired to any live transport yet.
 */
export interface AuthLifecycleHandlers {
  /** Invoked when the long-lived connection observes an auth failure. */
  onAuthFailure(code: number): void;
  /** Attempt to refresh the token via the established auth path. */
  refresh(): Promise<boolean>;
  /** Re-establish the transport with the refreshed token. */
  reconnect(): Promise<boolean>;
  /** Tear down the transport cleanly (panel close / session switch). */
  teardown(): void;
}

/**
 * Drives the state machine using the supplied handlers. Pure-ish orchestrator
 * over the transition() function; returns the terminal state. A5/A6 will attach
 * real handlers; tests use stubs.
 */
export async function runRecovery(
  handlers: Pick<AuthLifecycleHandlers, "refresh" | "reconnect">,
  failureCode: number,
): Promise<LifecycleState> {
  let state: LifecycleState = transition("connected", {
    type: "auth-failure",
    code: failureCode,
  });
  if (state === "prompt-relogin") {
    return state; // 403
  }

  state = transition(state, { type: "begin-refresh" });
  const refreshed = await handlers.refresh();
  state = transition(state, { type: "refresh-result", ok: refreshed });
  if (state === "prompt-relogin") {
    return state;
  }

  const reconnected = await handlers.reconnect();
  state = transition(state, { type: "reconnect-result", ok: reconnected });
  return state;
}

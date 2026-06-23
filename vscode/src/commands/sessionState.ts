/**
 * Simple mutable session state shared between commands.
 * Holds the active session ID and client options so A7/A8/A9 can reach them
 * without threading state through every function call.
 */
import type { ClientOptions } from "../api/client";
import type { HostType } from "../config";

export interface SessionState {
  sessionId: string | undefined;
  clientOpts: ClientOptions | undefined;
  hostType: HostType;
}

export function makeSessionState(): SessionState {
  return { sessionId: undefined, clientOpts: undefined, hostType: "unknown" };
}

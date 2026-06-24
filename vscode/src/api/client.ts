/**
 * Thin HTTP client for the Omnigent /v1 REST surface.
 *
 * Pure payload-construction functions are co-located here and tested
 * in isolation; the actual fetch calls are made through the injected
 * `fetchImpl` so integration tests can supply a stub.
 *
 * API surface (from the plan, Lane 1 evidence):
 *   POST /v1/sessions                              — create session
 *   GET  /v1/sessions/{id}                         — snapshot
 *   POST /v1/sessions/{id}/events                  — send events (message/interrupt/etc.)
 *   GET  /v1/sessions/{id}/stream                  — SSE stream
 *   GET  /v1/sessions/{id}/resources/files         — list changed files
 *   GET  /v1/sessions/{id}/resources/files/{fid}/content
 *   GET  /v1/sessions/{id}/resources/environments/{env}/diff/{path}
 *   GET  /api/agents
 */
import { mapHttpStatus } from "../auth/httpStatus";

export type FetchFn = typeof fetch;

export interface ClientOptions {
  baseUrl: string;
  /** Bearer token — undefined when no token is available. */
  token?: string;
  fetchImpl?: FetchFn;
}

export interface ApiResponse<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

/** Build the Authorization header when a token is present. */
export function buildAuthHeaders(token?: string): Record<string, string> {
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

/** Merge headers for an authenticated JSON request. */
export function buildRequestHeaders(token?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...buildAuthHeaders(token),
  };
}

/** Low-level authenticated fetch — the central request point for all /v1 calls. */
export async function apiFetch<T>(
  opts: ClientOptions,
  path: string,
  init: RequestInit = {},
): Promise<ApiResponse<T>> {
  const { baseUrl, token, fetchImpl = fetch } = opts;
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const headers = {
    ...buildRequestHeaders(token),
    ...(init.headers as Record<string, string> | undefined ?? {}),
  };
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, headers });
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }

  const outcome = mapHttpStatus(res.status);
  if (outcome === "ok") {
    try {
      const data = (await res.json()) as T;
      return { ok: true, status: res.status, data };
    } catch {
      return { ok: true, status: res.status };
    }
  }
  return { ok: false, status: res.status, error: outcome };
}

// ── Agents ─────────────────────────────────────────────────────────────────────

export interface Agent {
  id: string;
  name: string;
  description?: string;
}

/** List the agents available on the server. Required to create a session (agent_id). */
export async function listAgents(opts: ClientOptions): Promise<ApiResponse<Agent[]>> {
  return apiFetch<Agent[]>(opts, "/v1/agents");
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export interface Session {
  id: string;
  status?: string;
  [key: string]: unknown;
}

/**
 * Create a session. The server requires an `agent_id` in the body; posting `{}`
 * yields a 422 (`missing agent_id`). Callers resolve the agent first (default
 * setting or agent picker) and pass its id here.
 */
export async function createSession(
  opts: ClientOptions,
  agentId: string,
): Promise<ApiResponse<Session>> {
  return apiFetch<Session>(opts, "/v1/sessions", {
    method: "POST",
    body: JSON.stringify({ agent_id: agentId }),
  });
}

export async function getSession(opts: ClientOptions, id: string): Promise<ApiResponse<Session>> {
  return apiFetch<Session>(opts, `/v1/sessions/${id}`);
}

// ── Events ────────────────────────────────────────────────────────────────────

export type EventType = "message" | "interrupt" | "stop_session" | "compact" | "slash_command";

export interface SessionEvent {
  type: EventType;
  [key: string]: unknown;
}

/** Pure: build the message event payload for send-selection (A7). */
export function buildMessageEvent(
  content: string,
  workspaceRelativePath?: string,
): SessionEvent {
  return {
    type: "message",
    content,
    ...(workspaceRelativePath ? { context: { file: workspaceRelativePath } } : {}),
  };
}

export async function postSessionEvent(
  opts: ClientOptions,
  sessionId: string,
  event: SessionEvent,
): Promise<ApiResponse<unknown>> {
  return apiFetch(opts, `/v1/sessions/${sessionId}/events`, {
    method: "POST",
    body: JSON.stringify(event),
  });
}

// ── Changed files / diffs ─────────────────────────────────────────────────────

export interface ChangedFile {
  file_id: string;
  relative_path: string;
  environment_id?: string;
  [key: string]: unknown;
}

export async function listChangedFiles(
  opts: ClientOptions,
  sessionId: string,
): Promise<ApiResponse<ChangedFile[]>> {
  return apiFetch<ChangedFile[]>(opts, `/v1/sessions/${sessionId}/resources/files`);
}

export interface DiffResult {
  before: string;
  after: string;
  relative_path: string;
}

/** Pure: parse the diff API response into a typed DiffResult. */
export function parseDiffResponse(
  raw: Record<string, unknown>,
  relativePath: string,
): DiffResult {
  return {
    before: typeof raw.before === "string" ? raw.before : "",
    after: typeof raw.after === "string" ? raw.after : "",
    relative_path: relativePath,
  };
}

export async function fetchDiff(
  opts: ClientOptions,
  sessionId: string,
  environmentId: string,
  relativePath: string,
): Promise<ApiResponse<DiffResult>> {
  const encodedPath = relativePath.split("/").map(encodeURIComponent).join("/");
  const raw = await apiFetch<Record<string, unknown>>(
    opts,
    `/v1/sessions/${sessionId}/resources/environments/${environmentId}/diff/${encodedPath}`,
  );
  if (!raw.ok || !raw.data) return raw as unknown as ApiResponse<DiffResult>;
  return { ok: true, status: raw.status, data: parseDiffResponse(raw.data, relativePath) };
}

// ── SSE stream ────────────────────────────────────────────────────────────────

export interface SseEvent {
  event?: string;
  data: string;
}

/**
 * Parse a raw SSE chunk into SseEvent objects.
 * Pure — no network IO; testable with raw string input.
 */
export function parseSseChunk(chunk: string): SseEvent[] {
  const events: SseEvent[] = [];
  const blocks = chunk.split(/\n\n+/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    let event: string | undefined;
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (data) events.push({ event, data });
  }
  return events;
}

/**
 * Open an SSE stream for a session. Calls `onEvent` for each parsed event.
 * Returns a cleanup function that aborts the stream.
 * Uses the injected `fetchImpl` so it is stub-testable.
 */
export function openSseStream(
  opts: ClientOptions,
  sessionId: string,
  onEvent: (event: SseEvent) => void,
  onError?: (err: unknown) => void,
): () => void {
  const controller = new AbortController();
  const { baseUrl, token, fetchImpl = fetch } = opts;
  const url = `${baseUrl.replace(/\/$/, "")}/v1/sessions/${sessionId}/stream`;
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
    ...buildAuthHeaders(token),
  };

  (async () => {
    try {
      const res = await fetchImpl(url, { signal: controller.signal, headers });
      if (!res.ok || !res.body) {
        onError?.(new Error(`SSE stream failed: ${res.status}`));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = parseSseChunk(buf);
        // Only consume complete events (those followed by a blank line).
        const lastDoubleNewline = buf.lastIndexOf("\n\n");
        if (lastDoubleNewline >= 0) {
          buf = buf.slice(lastDoubleNewline + 2);
        }
        for (const e of events) onEvent(e);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      onError?.(err);
    }
  })();

  return () => controller.abort();
}

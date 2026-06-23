/**
 * Integration tests: API client + stub server.
 *
 * Asserts (per the plan test plan §8):
 *  - fetcher attaches Authorization on /v1/... calls AND on the /stream read (PM1 guard).
 *  - session-create + events POST shape.
 *  - resources/diff response parses into before/after (pure + network path).
 *  - apply is gated by host type.
 *  - auth-lifecycle 401→refresh→reconnect matches docs/conformance/auth-lifecycle.json.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { StubServer } from "./stubServer";
import {
  apiFetch,
  createSession,
  postSessionEvent,
  fetchDiff,
  listChangedFiles,
  buildMessageEvent,
  openSseStream,
  ClientOptions,
} from "../../api/client";
import { transition, LifecycleState, LifecycleEvent } from "../../auth/lifecycle";
import { isApplyAllowed } from "../../commands/diffs";
import { loadVectors } from "../vectors";

// ── Stub server lifecycle ─────────────────────────────────────────────────────

const stub = new StubServer();
beforeAll(() => stub.start());
afterAll(() => stub.stop());
beforeEach(() => stub.clearLog());

function opts(token?: string): ClientOptions {
  return { baseUrl: stub.baseUrl(), token, fetchImpl: fetch };
}

// ── PM1 guard: Authorization header on every request ─────────────────────────

describe("PM1: fetcher attaches Authorization header", () => {
  it("attaches Bearer on a /v1/sessions POST", async () => {
    stub.on("POST", "/v1/sessions", () => ({ status: 200, body: { id: "s1" } }));
    await createSession(opts("test-token"));
    const req = stub.lastRequest("POST", "/v1/sessions");
    expect(req?.headers["authorization"]).toBe("Bearer test-token");
  });

  it("attaches Bearer on a /v1/sessions/{id}/events POST (send-selection path)", async () => {
    stub.on("POST", "/v1/sessions/s1/events", () => ({ status: 200, body: {} }));
    await postSessionEvent(opts("test-token"), "s1", buildMessageEvent("hello", "src/foo.ts"));
    const req = stub.lastRequest("POST", "/v1/sessions/s1/events");
    expect(req?.headers["authorization"]).toBe("Bearer test-token");
  });

  it("attaches Bearer on /v1/sessions/{id}/stream (SSE — PM1 core)", async () => {
    // The SSE stream is opened via the same apiFetch path (fetcher covers it per gate doc).
    stub.on("GET", "/v1/sessions/s1/stream", () => ({
      status: 200,
      body: "event: session.message\ndata: {}\n\n",
    }));
    // Use apiFetch directly to assert the header without waiting for streaming.
    await apiFetch(opts("stream-token"), "/v1/sessions/s1/stream", {
      headers: { Accept: "text/event-stream" },
    });
    const req = stub.lastRequest("GET", "/v1/sessions/s1/stream");
    expect(req?.headers["authorization"]).toBe("Bearer stream-token");
  });

  it("omits Authorization when no token", async () => {
    stub.on("GET", "/health", () => ({ status: 200, body: { status: "ok" } }));
    await apiFetch(opts(undefined), "/health");
    const req = stub.lastRequest("GET", "/health");
    expect(req?.headers["authorization"]).toBeUndefined();
  });
});

// ── Session create + events shape ────────────────────────────────────────────

describe("session create and events", () => {
  it("createSession returns session id", async () => {
    stub.on("POST", "/v1/sessions", () => ({ status: 200, body: { id: "sess-abc", status: "running" } }));
    const result = await createSession(opts("tok"));
    expect(result.ok).toBe(true);
    expect(result.data?.id).toBe("sess-abc");
  });

  it("postSessionEvent sends correct event shape", async () => {
    let captured: unknown;
    stub.on("POST", "/v1/sessions/sess-abc/events", (req) => {
      captured = JSON.parse(req.body);
      return { status: 200, body: {} };
    });
    const event = buildMessageEvent("hello world", "src/main.ts");
    await postSessionEvent(opts("tok"), "sess-abc", event);
    expect(captured).toMatchObject({
      type: "message",
      content: "hello world",
      context: { file: "src/main.ts" },
    });
  });

  it("maps 401 response to reauth outcome", async () => {
    stub.on("POST", "/v1/sessions", () => ({ status: 401, body: { error: "unauthorized" } }));
    const result = await createSession(opts("bad-token"));
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toBe("reauth");
  });

  it("maps 403 to forbidden outcome", async () => {
    stub.on("POST", "/v1/sessions", () => ({ status: 403, body: { error: "forbidden" } }));
    const result = await createSession(opts("tok"));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("forbidden");
  });
});

// ── Resources/diff parse ──────────────────────────────────────────────────────

describe("resources/diff response parses into before/after", () => {
  it("fetchDiff returns typed DiffResult", async () => {
    stub.on(
      "GET",
      "/v1/sessions/s1/resources/environments/env1/diff/",
      () => ({
        status: 200,
        body: { before: "original content", after: "updated content" },
      }),
    );
    const result = await fetchDiff(opts("tok"), "s1", "env1", "src/a.ts");
    expect(result.ok).toBe(true);
    expect(result.data?.before).toBe("original content");
    expect(result.data?.after).toBe("updated content");
    expect(result.data?.relative_path).toBe("src/a.ts");
  });

  it("listChangedFiles returns file list", async () => {
    stub.on("GET", "/v1/sessions/s1/resources/files", () => ({
      status: 200,
      body: [
        { file_id: "f1", relative_path: "src/a.ts", environment_id: "env1" },
        { file_id: "f2", relative_path: "src/b.ts", environment_id: "env1" },
      ],
    }));
    const result = await listChangedFiles(opts("tok"), "s1");
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.data?.[0].relative_path).toBe("src/a.ts");
  });
});

// ── Apply host-type gating ────────────────────────────────────────────────────

describe("apply gating by host type", () => {
  it("allows apply for local", () => expect(isApplyAllowed("local")).toBe(true));
  it("blocks apply for remote", () => expect(isApplyAllowed("remote")).toBe(false));
  it("blocks apply for unknown", () => expect(isApplyAllowed("unknown")).toBe(false));
});

// ── Auth lifecycle conformance (401→refresh→reconnect) ────────────────────────

describe("auth lifecycle: conformance vector (auth-lifecycle.json)", () => {
  interface LifecycleVectors {
    scenarios: Array<{
      name: string;
      initialState: LifecycleState;
      transitions: Array<{ event: LifecycleEvent; expectedState: LifecycleState }>;
    }>;
  }

  const vectors = loadVectors<LifecycleVectors>("auth-lifecycle.json");

  for (const scenario of vectors.scenarios) {
    it(`integration: ${scenario.name}`, () => {
      let state = scenario.initialState;
      for (const step of scenario.transitions) {
        state = transition(state, step.event);
        expect(state).toBe(step.expectedState);
      }
    });
  }
});

// ── SSE stream: Authorization header reaches the stream endpoint ──────────────

describe("SSE stream via openSseStream attaches Authorization", () => {
  it("sends Bearer on GET /v1/sessions/{id}/stream", async () => {
    // The stub returns a minimal valid SSE body then closes.
    stub.on("GET", "/v1/sessions/sse-s1/stream", () => ({
      status: 200,
      body: "event: done\ndata: [DONE]\n\n",
    }));

    await new Promise<void>((resolve, reject) => {
      const stop = openSseStream(
        opts("sse-token"),
        "sse-s1",
        (_evt) => { stop(); resolve(); },
        (err) => { reject(err); },
      );
      // Safety timeout.
      setTimeout(() => { stop(); resolve(); }, 2000);
    });

    const req = stub.lastRequest("GET", "/v1/sessions/sse-s1/stream");
    expect(req?.headers["authorization"]).toBe("Bearer sse-token");
  });
});

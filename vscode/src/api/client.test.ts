import { describe, it, expect } from "vitest";
import {
  buildAuthHeaders,
  buildRequestHeaders,
  buildMessageEvent,
  parseDiffResponse,
  parseSseChunk,
  createSession,
  listAgents,
  accumulateSessions,
  listSessions,
  listSessionsPage,
  type ClientOptions,
  type FetchFn,
  type Session,
  type SessionsPage,
} from "./client";

/** Build a SessionsPage with the given sessions and cursor fields. */
function page(
  data: Partial<Session>[],
  extra: Partial<SessionsPage> = {},
): SessionsPage {
  return {
    object: "list",
    data: data.map((s) => ({ id: "conv_x", ...s })) as Session[],
    ...extra,
  };
}

/** Build ClientOptions with a fetch stub that records the last call and returns `body`. */
function stubFetch(status: number, body: unknown): {
  opts: ClientOptions;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: unknown, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as FetchFn;
  return { opts: { baseUrl: "http://127.0.0.1:6767", fetchImpl }, calls };
}

describe("buildAuthHeaders", () => {
  it("returns Authorization header when token present", () => {
    expect(buildAuthHeaders("tok")).toEqual({ Authorization: "Bearer tok" });
  });
  it("returns empty object when no token", () => {
    expect(buildAuthHeaders(undefined)).toEqual({});
    expect(buildAuthHeaders("")).toEqual({});
  });
});

describe("buildRequestHeaders", () => {
  it("includes Content-Type and Authorization", () => {
    const h = buildRequestHeaders("tok");
    expect(h["Content-Type"]).toBe("application/json");
    expect(h["Authorization"]).toBe("Bearer tok");
  });
  it("omits Authorization when no token", () => {
    const h = buildRequestHeaders();
    expect(h["Authorization"]).toBeUndefined();
  });
});

describe("buildMessageEvent", () => {
  it("builds a message event with file context", () => {
    const e = buildMessageEvent("hello", "src/foo.ts");
    expect(e.type).toBe("message");
    expect(e.content).toBe("hello");
    expect((e as Record<string, unknown>).context).toEqual({ file: "src/foo.ts" });
  });
  it("omits context when no path", () => {
    const e = buildMessageEvent("hello");
    expect((e as Record<string, unknown>).context).toBeUndefined();
  });
});

describe("createSession", () => {
  it("POSTs agent_id in the body (fixes the 422 missing agent_id)", async () => {
    const { opts, calls } = stubFetch(201, { id: "conv_123" });
    const res = await createSession(opts, "ag_42");
    expect(res.ok).toBe(true);
    expect(res.data?.id).toBe("conv_123");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://127.0.0.1:6767/v1/sessions");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ agent_id: "ag_42" });
  });
});

describe("listAgents", () => {
  it("GETs /v1/agents and returns the agent list", async () => {
    const agents = [
      { id: "ag_1", name: "Coder", description: "writes code" },
      { id: "ag_2", name: "Reviewer" },
    ];
    const { opts, calls } = stubFetch(200, agents);
    const res = await listAgents(opts);
    expect(res.ok).toBe(true);
    expect(res.data).toEqual(agents);
    expect(calls[0].url).toBe("http://127.0.0.1:6767/v1/agents");
  });
});

describe("parseDiffResponse", () => {
  it("extracts before/after strings", () => {
    const r = parseDiffResponse({ before: "old", after: "new" }, "src/a.ts");
    expect(r).toEqual({ before: "old", after: "new", relative_path: "src/a.ts" });
  });
  it("falls back to empty strings for missing fields", () => {
    const r = parseDiffResponse({}, "src/a.ts");
    expect(r.before).toBe("");
    expect(r.after).toBe("");
  });
});

describe("parseSseChunk", () => {
  it("parses a single complete event", () => {
    const events = parseSseChunk("event: session.message\ndata: {\"x\":1}\n\n");
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("session.message");
    expect(events[0].data).toBe('{"x":1}');
  });
  it("parses multiple events", () => {
    const chunk = "event: a\ndata: 1\n\nevent: b\ndata: 2\n\n";
    const events = parseSseChunk(chunk);
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe("a");
    expect(events[1].event).toBe("b");
  });
  it("handles events with no event field", () => {
    const events = parseSseChunk("data: hello\n\n");
    expect(events[0].event).toBeUndefined();
    expect(events[0].data).toBe("hello");
  });
  it("parses changed_files invalidation event", () => {
    const events = parseSseChunk(
      "event: session.changed_files.invalidated\ndata: {}\n\n",
    );
    expect(events[0].event).toBe("session.changed_files.invalidated");
  });
  it("ignores empty blocks", () => {
    expect(parseSseChunk("\n\n\n")).toHaveLength(0);
  });
});

/** A fetch stub that returns each queued response in order, recording calls. */
function sequenceFetch(
  responses: Array<{ status: number; body: unknown }>,
): { opts: ClientOptions; calls: Array<{ url: string }> } {
  const calls: Array<{ url: string }> = [];
  let i = 0;
  const fetchImpl = (async (url: unknown) => {
    calls.push({ url: String(url) });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      json: async () => r.body,
    } as unknown as Response;
  }) as unknown as FetchFn;
  return { opts: { baseUrl: "http://127.0.0.1:6767", fetchImpl }, calls };
}

describe("accumulateSessions", () => {
  it("concatenates a single page in order", () => {
    const { sessions, truncated } = accumulateSessions(
      [page([{ id: "a" }, { id: "b" }], { has_more: false })],
      200,
    );
    expect(sessions.map((s) => s.id)).toEqual(["a", "b"]);
    expect(truncated).toBe(false);
  });

  it("concatenates multiple pages in cursor order", () => {
    const { sessions } = accumulateSessions(
      [
        page([{ id: "a" }, { id: "b" }], { has_more: true, last_id: "b" }),
        page([{ id: "c" }], { has_more: false }),
      ],
      200,
    );
    expect(sessions.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("truncates when has_more is still true at the cap", () => {
    const { sessions, truncated } = accumulateSessions(
      [page([{ id: "a" }, { id: "b" }, { id: "c" }], { has_more: true })],
      2,
    );
    expect(sessions.map((s) => s.id)).toEqual(["a", "b"]);
    expect(truncated).toBe(true);
  });

  it("is not truncated when the final page has has_more false even at the cap", () => {
    const { sessions, truncated } = accumulateSessions(
      [page([{ id: "a" }, { id: "b" }], { has_more: false })],
      2,
    );
    expect(sessions.map((s) => s.id)).toEqual(["a", "b"]);
    expect(truncated).toBe(false);
  });
});

describe("listSessionsPage", () => {
  it("sets limit and after query params when provided", async () => {
    const { opts, calls } = sequenceFetch([
      { status: 200, body: page([{ id: "a" }]) },
    ]);
    await listSessionsPage(opts, { limit: 50, after: "cur_1" });
    expect(calls[0].url).toBe(
      "http://127.0.0.1:6767/v1/sessions?limit=50&after=cur_1",
    );
  });

  it("omits query params when none provided", async () => {
    const { opts, calls } = sequenceFetch([
      { status: 200, body: page([]) },
    ]);
    await listSessionsPage(opts);
    expect(calls[0].url).toBe("http://127.0.0.1:6767/v1/sessions");
  });
});

describe("listSessions", () => {
  it("follows the after/has_more cursor chain and accumulates sessions", async () => {
    const { opts, calls } = sequenceFetch([
      { status: 200, body: page([{ id: "a" }, { id: "b" }], { has_more: true, last_id: "b" }) },
      { status: 200, body: page([{ id: "c" }], { has_more: false, last_id: "c" }) },
    ]);
    const res = await listSessions(opts);
    expect(res.ok).toBe(true);
    expect(res.data?.sessions.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(res.data?.truncated).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain("after=b");
  });

  it("stops at the cap without following further pages and reports truncated", async () => {
    const { opts, calls } = sequenceFetch([
      { status: 200, body: page([{ id: "a" }, { id: "b" }], { has_more: true, last_id: "b" }) },
    ]);
    const res = await listSessions(opts, 2);
    expect(res.data?.sessions.map((s) => s.id)).toEqual(["a", "b"]);
    // has_more && size === cap -> truncated
    expect(res.data?.truncated).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("is NOT truncated at exactly the cap when the last page has has_more false", async () => {
    const { opts, calls } = sequenceFetch([
      { status: 200, body: page([{ id: "a" }, { id: "b" }], { has_more: false, last_id: "b" }) },
    ]);
    const res = await listSessions(opts, 2);
    expect(res.data?.sessions.map((s) => s.id)).toEqual(["a", "b"]);
    expect(res.data?.truncated).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("propagates a 401 as a non-ok response without throwing", async () => {
    const { opts } = sequenceFetch([{ status: 401, body: {} }]);
    const res = await listSessions(opts);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect(res.error).toBe("reauth");
  });

  it("propagates a 403 as a non-ok response", async () => {
    const { opts } = sequenceFetch([{ status: 403, body: {} }]);
    const res = await listSessions(opts);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
    expect(res.error).toBe("forbidden");
  });

  it("maps a network error to status 0", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as FetchFn;
    const res = await listSessions({ baseUrl: "http://127.0.0.1:6767", fetchImpl });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
  });
});

describe("pinned Session parsing", () => {
  it("preserves optional fields and the archived boolean", async () => {
    const session: Session = {
      id: "conv_1",
      agent_name: "claude-native-ui",
      status: "running",
      created_at: 1700000000,
      updated_at: 1700000100,
      title: "Fix the bug",
      workspace: "/abs/path",
      git_branch: "feat/x",
      archived: true,
      labels: { kind: "demo" },
    };
    const { opts } = sequenceFetch([
      { status: 200, body: page([session], { has_more: false }) },
    ]);
    const res = await listSessions(opts);
    const got = res.data?.sessions[0];
    expect(got?.archived).toBe(true);
    expect(got?.title).toBe("Fix the bug");
    expect(got?.workspace).toBe("/abs/path");
    expect(got?.git_branch).toBe("feat/x");
    expect(got?.labels).toEqual({ kind: "demo" });
  });

  it("parses a session that omits the optional fields", async () => {
    const { opts } = sequenceFetch([
      { status: 200, body: page([{ id: "conv_2" }], { has_more: false }) },
    ]);
    const res = await listSessions(opts);
    const got = res.data?.sessions[0];
    expect(got?.id).toBe("conv_2");
    expect(got?.title).toBeUndefined();
    expect(got?.archived).toBeUndefined();
  });
});

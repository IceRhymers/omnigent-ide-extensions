import { describe, it, expect } from "vitest";
import {
  buildAuthHeaders,
  buildRequestHeaders,
  buildMessageEvent,
  parseDiffResponse,
  parseSseChunk,
} from "./client";

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

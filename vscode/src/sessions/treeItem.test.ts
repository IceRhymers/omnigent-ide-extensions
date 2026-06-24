import { describe, it, expect } from "vitest";
import {
  deriveLabel,
  relativeTime,
  statusThemeIconId,
  toItemView,
  sortSessions,
} from "./treeItem";
import type { Session } from "../api/client";

function sess(over: Partial<Session> = {}): Session {
  return { id: "conv_1", ...over };
}

describe("deriveLabel", () => {
  it("uses the title when present", () => {
    expect(deriveLabel(sess({ title: "Fix bug" }))).toBe("Fix bug");
  });
  it("falls back to a short id-derived label", () => {
    expect(deriveLabel(sess({ id: "conv_abcdef123456" }))).toBe("Session abcdef12");
  });
  it("falls back when the title is blank", () => {
    expect(deriveLabel(sess({ id: "conv_xy", title: "   " }))).toBe("Session xy");
  });
});

describe("relativeTime", () => {
  const now = 1_700_000_000_000; // ms
  it("converts seconds to ms and reports 'just now' under a minute", () => {
    expect(relativeTime(now / 1000 - 30, now)).toBe("just now");
  });
  it("reports minutes at the 60s boundary", () => {
    expect(relativeTime(now / 1000 - 60, now)).toBe("1m ago");
    expect(relativeTime(now / 1000 - 59 * 60, now)).toBe("59m ago");
  });
  it("reports hours at the 60m boundary", () => {
    expect(relativeTime(now / 1000 - 60 * 60, now)).toBe("1h ago");
    expect(relativeTime(now / 1000 - 23 * 3600, now)).toBe("23h ago");
  });
  it("reports days at the 24h boundary", () => {
    expect(relativeTime(now / 1000 - 24 * 3600, now)).toBe("1d ago");
    expect(relativeTime(now / 1000 - 5 * 24 * 3600, now)).toBe("5d ago");
  });
  it("clamps future timestamps to 'just now'", () => {
    expect(relativeTime(now / 1000 + 100, now)).toBe("just now");
  });
});

describe("statusThemeIconId", () => {
  it("prefers archive when archived", () => {
    expect(statusThemeIconId("running", true)).toBe("archive");
  });
  it("maps known statuses", () => {
    expect(statusThemeIconId("running")).toBe("play-circle");
    expect(statusThemeIconId("idle")).toBe("circle-outline");
    expect(statusThemeIconId("error")).toBe("error");
    expect(statusThemeIconId("failed")).toBe("error");
  });
  it("falls back to circle-outline for unknown/missing status", () => {
    expect(statusThemeIconId()).toBe("circle-outline");
    expect(statusThemeIconId("something")).toBe("circle-outline");
  });
});

describe("toItemView", () => {
  const now = 1_700_000_000_000;
  it("builds label, description, tooltip, icon, and contextValue", () => {
    const view = toItemView(
      sess({
        id: "conv_1",
        title: "My session",
        agent_name: "coder",
        status: "running",
        workspace: "/repo",
        git_branch: "main",
        created_at: now / 1000 - 3600,
        updated_at: now / 1000 - 120,
      }),
      now,
    );
    expect(view.id).toBe("conv_1");
    expect(view.label).toBe("My session");
    expect(view.description).toBe("coder · 2m ago");
    expect(view.themeIconId).toBe("play-circle");
    expect(view.contextValue).toBe("omnigentSession");
    expect(view.tooltip).toContain("Workspace: /repo");
    expect(view.tooltip).toContain("Branch: main");
  });
  it("handles a minimal session", () => {
    const view = toItemView(sess({ id: "conv_zz" }), now);
    expect(view.label).toBe("Session zz");
    expect(view.description).toBe("");
    expect(view.tooltip).toBe("Session zz");
  });
});

describe("sortSessions", () => {
  it("sorts by updated_at desc with id tiebreak and does not mutate input", () => {
    const input: Session[] = [
      sess({ id: "b", updated_at: 100 }),
      sess({ id: "a", updated_at: 200 }),
      sess({ id: "c", updated_at: 100 }),
    ];
    const out = sortSessions(input);
    expect(out.map((s) => s.id)).toEqual(["a", "b", "c"]);
    // Input untouched.
    expect(input.map((s) => s.id)).toEqual(["b", "a", "c"]);
  });
  it("treats missing updated_at as 0 (sorts last)", () => {
    const out = sortSessions([sess({ id: "x" }), sess({ id: "y", updated_at: 5 })]);
    expect(out.map((s) => s.id)).toEqual(["y", "x"]);
  });
});

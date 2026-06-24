import { describe, it, expect } from "vitest";
import {
  defaultFilter,
  matchesFilter,
  normalizeWorkspacePath,
  isFilterActive,
  type SessionFilter,
} from "./filter";
import type { Session } from "../api/client";

function sess(over: Partial<Session> = {}): Session {
  return { id: "conv_1", ...over };
}

describe("defaultFilter", () => {
  it("hides archived and nothing else", () => {
    expect(defaultFilter()).toEqual({ hideArchived: true, currentFolderOnly: false });
  });
});

describe("normalizeWorkspacePath", () => {
  it("trims a trailing slash and normalizes separators", () => {
    expect(normalizeWorkspacePath("/a/b/")).toBe("/a/b");
    expect(normalizeWorkspacePath("C:\\a\\b\\")).toBe("c:/a/b");
  });
  it("lowercases on darwin (test host)", () => {
    // The test host is darwin; comparison is case-insensitive there.
    expect(normalizeWorkspacePath("/A/B")).toBe("/a/b");
  });
});

describe("matchesFilter", () => {
  it("hideArchived drops archived sessions", () => {
    expect(matchesFilter(sess({ archived: true }), defaultFilter())).toBe(false);
    expect(matchesFilter(sess({ archived: false }), defaultFilter())).toBe(true);
    expect(matchesFilter(sess({}), defaultFilter())).toBe(true);
  });

  it("keeps archived sessions when hideArchived is off", () => {
    const f: SessionFilter = { hideArchived: false, currentFolderOnly: false };
    expect(matchesFilter(sess({ archived: true }), f)).toBe(true);
  });

  it("currentFolderOnly matches by normalized workspace path", () => {
    const f: SessionFilter = {
      hideArchived: false,
      currentFolderOnly: true,
      workspacePath: "/Repo/App/",
    };
    expect(matchesFilter(sess({ workspace: "/repo/app" }), f)).toBe(true);
    expect(matchesFilter(sess({ workspace: "/other" }), f)).toBe(false);
    expect(matchesFilter(sess({}), f)).toBe(false);
  });

  it("matches agentName, status, and gitBranch exactly", () => {
    const base: SessionFilter = { hideArchived: false, currentFolderOnly: false };
    expect(matchesFilter(sess({ agent_name: "coder" }), { ...base, agentName: "coder" })).toBe(true);
    expect(matchesFilter(sess({ agent_name: "coder" }), { ...base, agentName: "other" })).toBe(false);
    expect(matchesFilter(sess({ status: "running" }), { ...base, status: "running" })).toBe(true);
    expect(matchesFilter(sess({ git_branch: "main" }), { ...base, gitBranch: "dev" })).toBe(false);
  });

  it("titleQuery is a case-insensitive substring match", () => {
    const base: SessionFilter = { hideArchived: false, currentFolderOnly: false };
    expect(matchesFilter(sess({ title: "Fix the Bug" }), { ...base, titleQuery: "bug" })).toBe(true);
    expect(matchesFilter(sess({ title: "Fix the Bug" }), { ...base, titleQuery: "feature" })).toBe(false);
    expect(matchesFilter(sess({}), { ...base, titleQuery: "x" })).toBe(false);
  });

  it("AND-combines all active dimensions", () => {
    const f: SessionFilter = {
      hideArchived: true,
      currentFolderOnly: false,
      agentName: "coder",
      status: "running",
      titleQuery: "deploy",
    };
    const match = sess({ agent_name: "coder", status: "running", title: "Deploy step" });
    expect(matchesFilter(match, f)).toBe(true);
    // One mismatch fails the whole filter.
    expect(matchesFilter({ ...match, status: "idle" }, f)).toBe(false);
  });
});

describe("isFilterActive", () => {
  it("is false for the default filter", () => {
    expect(isFilterActive(defaultFilter())).toBe(false);
  });
  it("is true when any dimension differs from default", () => {
    expect(isFilterActive({ hideArchived: false, currentFolderOnly: false })).toBe(true);
    expect(isFilterActive({ hideArchived: true, currentFolderOnly: true })).toBe(true);
    expect(isFilterActive({ ...defaultFilter(), agentName: "x" })).toBe(true);
    expect(isFilterActive({ ...defaultFilter(), titleQuery: "x" })).toBe(true);
  });
  it("treats an empty titleQuery as inactive", () => {
    expect(isFilterActive({ ...defaultFilter(), titleQuery: "" })).toBe(false);
  });
});

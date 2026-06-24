import { describe, it, expect } from "vitest";
import { statusBarLabel, statusBarTooltip, agentPickItems } from "./openSession";

describe("agentPickItems", () => {
  it("maps agents to QuickPick items carrying the agent id", () => {
    const items = agentPickItems([
      { id: "ag_1", name: "Coder", description: "writes code" },
      { id: "ag_2", name: "Reviewer" },
    ]);
    expect(items).toEqual([
      { label: "Coder", detail: "writes code", agentId: "ag_1" },
      { label: "Reviewer", detail: undefined, agentId: "ag_2" },
    ]);
  });
  it("returns an empty array for no agents", () => {
    expect(agentPickItems([])).toEqual([]);
  });
});

describe("statusBarLabel", () => {
  it("shows check + home for connected local", () => {
    const label = statusBarLabel("connected", "local");
    expect(label).toContain("$(check)");
    expect(label).toContain("$(home)");
  });
  it("shows spinning sync for connecting", () => {
    expect(statusBarLabel("connecting", "remote")).toContain("$(sync~spin)");
  });
  it("shows error icon for error state", () => {
    expect(statusBarLabel("error", "local")).toContain("$(error)");
  });
  it("shows cloud icon for remote", () => {
    expect(statusBarLabel("connected", "remote")).toContain("$(cloud)");
  });
  it("shows question for unknown hostType", () => {
    expect(statusBarLabel("idle", "unknown")).toContain("$(question)");
  });
});

describe("statusBarTooltip", () => {
  it("includes session id when provided", () => {
    const tip = statusBarTooltip("connected", "local", "sess-123");
    expect(tip).toContain("sess-123");
    expect(tip).toContain("Connected");
    expect(tip).toContain("Local server");
  });
  it("omits session line when not provided", () => {
    const tip = statusBarTooltip("idle", "remote");
    expect(tip).not.toContain("Session:");
    expect(tip).toContain("Remote server");
  });
  it("shows connecting state", () => {
    expect(statusBarTooltip("connecting", "local")).toContain("Connecting");
  });
});

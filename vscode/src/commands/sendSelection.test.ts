import { describe, it, expect } from "vitest";
import { computeSelectionPayload, workspaceRelativePath } from "./sendSelection";

describe("workspaceRelativePath", () => {
  it("strips workspace root prefix", () => {
    expect(workspaceRelativePath("/home/user/proj/src/foo.ts", "/home/user/proj")).toBe(
      "src/foo.ts",
    );
  });
  it("falls back to absolute when outside workspace", () => {
    expect(workspaceRelativePath("/tmp/other.ts", "/home/user/proj")).toBe("/tmp/other.ts");
  });
  it("handles trailing slash on root", () => {
    expect(workspaceRelativePath("/home/user/proj/bar.ts", "/home/user/proj/")).toBe("bar.ts");
  });
});

describe("computeSelectionPayload", () => {
  it("uses selected text and computes relative path", () => {
    const p = computeSelectionPayload("hello world", "/proj/src/foo.ts", "/proj");
    expect(p.content).toBe("hello world");
    expect(p.relativePath).toBe("src/foo.ts");
  });
  it("falls back to (no selection) when text is empty", () => {
    const p = computeSelectionPayload("  ", "/proj/src/foo.ts", "/proj");
    expect(p.content).toBe("(no selection)");
  });
  it("omits relativePath when no file path", () => {
    const p = computeSelectionPayload("text", undefined, "/proj");
    expect(p.relativePath).toBeUndefined();
  });
  it("uses absolute path when no workspace root", () => {
    const p = computeSelectionPayload("text", "/proj/src/foo.ts", undefined);
    expect(p.relativePath).toBe("/proj/src/foo.ts");
  });
});

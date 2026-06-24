import { describe, it, expect, vi } from "vitest";
import {
  isApplyAllowed,
  isChangedFilesEvent,
  buildApplyPlan,
  executeApplyPlan,
  revertFromSnapshots,
} from "./diffs";

describe("isApplyAllowed", () => {
  it("allows apply for local", () => expect(isApplyAllowed("local")).toBe(true));
  it("denies apply for remote", () => expect(isApplyAllowed("remote")).toBe(false));
  it("denies apply for unknown", () => expect(isApplyAllowed("unknown")).toBe(false));
});

describe("isChangedFilesEvent", () => {
  it("matches the invalidation event", () => {
    expect(isChangedFilesEvent({ event: "session.changed_files.invalidated", data: "{}" })).toBe(true);
  });
  it("rejects other events", () => {
    expect(isChangedFilesEvent({ event: "session.message", data: "{}" })).toBe(false);
  });
  it("rejects events with no event field", () => {
    expect(isChangedFilesEvent({ data: "{}" })).toBe(false);
  });
});

describe("buildApplyPlan", () => {
  it("maps diffs to path+after pairs", () => {
    const plan = buildApplyPlan([
      { before: "old", after: "new", relative_path: "src/a.ts" },
      { before: "", after: "created", relative_path: "src/b.ts" },
    ]);
    expect(plan).toEqual([
      { path: "src/a.ts", after: "new" },
      { path: "src/b.ts", after: "created" },
    ]);
  });
});

describe("executeApplyPlan", () => {
  it("snapshots before writing and reports applied", async () => {
    const reads: Record<string, string> = { "/root/src/a.ts": "original" };
    const writes: Record<string, string> = {};
    const readFile = vi.fn(async (p: string) => {
      if (reads[p] !== undefined) return reads[p];
      throw new Error("ENOENT");
    });
    const writeFile = vi.fn(async (p: string, c: string) => { writes[p] = c; });

    const result = await executeApplyPlan(
      [{ path: "src/a.ts", after: "updated" }],
      "/root",
      readFile,
      writeFile,
    );

    expect(result.applied).toEqual(["src/a.ts"]);
    expect(result.failed).toEqual([]);
    expect(result.snapshots.get("src/a.ts")).toBe("original");
    expect(writes["/root/src/a.ts"]).toBe("updated");
  });

  it("snapshots missing file as empty string (new file)", async () => {
    const writeFile = vi.fn(async (_p: string, _c: string) => {});
    const readFile = vi.fn(async (_p: string): Promise<string> => { throw new Error("ENOENT"); });

    const result = await executeApplyPlan(
      [{ path: "src/new.ts", after: "content" }],
      "/root",
      readFile,
      writeFile,
    );

    expect(result.snapshots.get("src/new.ts")).toBe("");
    expect(result.applied).toEqual(["src/new.ts"]);
  });

  it("records failed files when write throws", async () => {
    const readFile = vi.fn(async (_p: string) => "prior");
    const writeFile = vi.fn(async (_p: string, _c: string): Promise<void> => {
      throw new Error("EPERM");
    });

    const result = await executeApplyPlan(
      [{ path: "src/a.ts", after: "new" }],
      "/root",
      readFile,
      writeFile,
    );

    expect(result.failed).toEqual(["src/a.ts"]);
    expect(result.applied).toEqual([]);
  });

  it("stops after first failure (partial apply)", async () => {
    const writes: string[] = [];
    const readFile = vi.fn(async (_p: string) => "prior");
    const writeFile = vi.fn(async (p: string, _c: string): Promise<void> => {
      if (p.includes("b.ts")) throw new Error("fail");
      writes.push(p);
    });

    const result = await executeApplyPlan(
      [
        { path: "src/a.ts", after: "A" },
        { path: "src/b.ts", after: "B" },
        { path: "src/c.ts", after: "C" },
      ],
      "/root",
      readFile,
      writeFile,
    );

    expect(result.applied).toContain("src/a.ts");
    expect(result.failed).toContain("src/b.ts");
    // c.ts should NOT be applied after b.ts failed
    expect(result.applied).not.toContain("src/c.ts");
  });
});

describe("revertFromSnapshots", () => {
  it("writes prior content from snapshots", async () => {
    const written: Record<string, string> = {};
    const writeFile = vi.fn(async (p: string, c: string) => { written[p] = c; });
    const snapshots = new Map([["src/a.ts", "original"]]);

    const failed = await revertFromSnapshots(["src/a.ts"], snapshots, "/root", writeFile);

    expect(failed).toEqual([]);
    expect(written["/root/src/a.ts"]).toBe("original");
  });

  it("reports paths that could not be reverted", async () => {
    const writeFile = vi.fn(async (_p: string, _c: string): Promise<void> => {
      throw new Error("EPERM");
    });
    const snapshots = new Map([["src/a.ts", "original"]]);

    const failed = await revertFromSnapshots(["src/a.ts"], snapshots, "/root", writeFile);

    expect(failed).toEqual(["src/a.ts"]);
  });
});

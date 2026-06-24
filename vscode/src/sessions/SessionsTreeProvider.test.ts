import { describe, it, expect, vi } from "vitest";
import { SessionsTreeProvider, type SessionsNode } from "./SessionsTreeProvider";
import type { ClientOptions, Session, SessionsPage } from "../api/client";

/** A fetch stub returning queued pages in order; non-2xx statuses are honored. */
function clientWith(
  responses: Array<{ status: number; body: unknown }>,
): ClientOptions {
  let i = 0;
  const fetchImpl = (async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      json: async () => r.body,
    } as unknown as Response;
  }) as unknown as ClientOptions["fetchImpl"];
  return { baseUrl: "http://127.0.0.1:6767", fetchImpl };
}

function page(data: Partial<Session>[], extra: Partial<SessionsPage> = {}): SessionsPage {
  return {
    object: "list",
    data: data.map((s) => ({ id: "conv_x", ...s })) as Session[],
    ...extra,
  };
}

const output = { appendLine: () => {} } as unknown as import("vscode").OutputChannel;

function labels(nodes: SessionsNode[]): string[] {
  return nodes.map((n) => (n.kind === "message" ? n.label : n.session.id));
}

describe("SessionsTreeProvider state nodes", () => {
  it("reports no-server when client opts are undefined", async () => {
    const p = new SessionsTreeProvider(() => undefined, output);
    await p.refresh();
    expect(labels(p.getChildren())).toEqual(["Omnigent server unreachable"]);
  });

  it("reports unauthorized on 401", async () => {
    const opts = clientWith([{ status: 401, body: {} }]);
    const p = new SessionsTreeProvider(() => opts, output);
    await p.refresh();
    expect(labels(p.getChildren())).toEqual([
      "Not authorized (401/403) — check your token",
    ]);
  });

  it("reports unauthorized on 403", async () => {
    const opts = clientWith([{ status: 403, body: {} }]);
    const p = new SessionsTreeProvider(() => opts, output);
    await p.refresh();
    expect(labels(p.getChildren())).toEqual([
      "Not authorized (401/403) — check your token",
    ]);
  });

  it("reports error on a 500", async () => {
    const opts = clientWith([{ status: 500, body: {} }]);
    const p = new SessionsTreeProvider(() => opts, output);
    await p.refresh();
    expect(labels(p.getChildren())).toEqual(["Omnigent server unreachable"]);
  });

  it("reports empty when there are no sessions", async () => {
    const opts = clientWith([{ status: 200, body: page([], { has_more: false }) }]);
    const p = new SessionsTreeProvider(() => opts, output);
    await p.refresh();
    expect(labels(p.getChildren())).toEqual(["No sessions"]);
  });

  it("lists sessions sorted by updated_at desc when ready", async () => {
    const opts = clientWith([
      {
        status: 200,
        body: page(
          [
            { id: "old", updated_at: 100 },
            { id: "new", updated_at: 200 },
          ],
          { has_more: false },
        ),
      },
    ]);
    const p = new SessionsTreeProvider(() => opts, output);
    await p.refresh();
    expect(labels(p.getChildren())).toEqual(["new", "old"]);
  });

  it("shows the no-match message when a filter excludes everything", async () => {
    const opts = clientWith([
      { status: 200, body: page([{ id: "a", agent_name: "coder" }], { has_more: false }) },
    ]);
    const p = new SessionsTreeProvider(() => opts, output);
    await p.refresh();
    p.getFilter().agentName = "nobody";
    expect(labels(p.getChildren())).toEqual(["No sessions match the active filter"]);
  });

  it("hides archived sessions by default", async () => {
    const opts = clientWith([
      {
        status: 200,
        body: page(
          [
            { id: "a", archived: true, updated_at: 2 },
            { id: "b", updated_at: 1 },
          ],
          { has_more: false },
        ),
      },
    ]);
    const p = new SessionsTreeProvider(() => opts, output);
    await p.refresh();
    expect(labels(p.getChildren())).toEqual(["b"]);
  });
});

describe("SessionsTreeProvider truncation", () => {
  it("appends a 'Showing first N' node when the cap is reached with has_more true", async () => {
    // cap is 200 in the provider; build 200 sessions with has_more true on the page.
    const data = Array.from({ length: 200 }, (_, i) => ({
      id: `conv_${i}`,
      updated_at: 1000 - i,
    }));
    const opts = clientWith([{ status: 200, body: page(data, { has_more: true, last_id: "conv_199" }) }]);
    const p = new SessionsTreeProvider(() => opts, output);
    await p.refresh();
    const nodes = p.getChildren();
    const last = nodes[nodes.length - 1];
    expect(last.kind).toBe("message");
    expect(last.kind === "message" && last.label).toBe("Showing first 200");
  });

  it("does NOT append the footer at exactly the cap when has_more is false", async () => {
    // Boundary delta from the canonical `truncated` definition: exactly 200
    // sessions with has_more:false is NOT truncated (old `size >= CAP` would
    // have flagged it). No "Showing first N" footer must appear.
    const data = Array.from({ length: 200 }, (_, i) => ({
      id: `conv_${i}`,
      updated_at: 1000 - i,
    }));
    const opts = clientWith([{ status: 200, body: page(data, { has_more: false, last_id: "conv_199" }) }]);
    const p = new SessionsTreeProvider(() => opts, output);
    await p.refresh();
    const nodes = p.getChildren();
    expect(nodes).toHaveLength(200);
    expect(nodes.every((n) => n.kind === "session")).toBe(true);
  });
});

describe("SessionsTreeProvider.getTreeItem", () => {
  it("maps a session node to a clickable tree item", () => {
    const p = new SessionsTreeProvider(() => undefined, output);
    const item = p.getTreeItem({
      kind: "session",
      session: { id: "conv_1", title: "Hi", status: "running" },
    });
    expect(item.label).toBe("Hi");
    expect(item.id).toBe("conv_1");
    expect((item.command as { command: string; arguments: unknown[] }).command).toBe(
      "omnigent.openSessionFromTree",
    );
    expect((item.command as { arguments: unknown[] }).arguments).toEqual(["conv_1"]);
    expect((item.iconPath as { id: string }).id).toBe("play-circle");
  });

  it("maps a message node to a plain, non-selectable item", () => {
    const p = new SessionsTreeProvider(() => undefined, output);
    const item = p.getTreeItem({ kind: "message", label: "Loading…" });
    expect(item.label).toBe("Loading…");
    expect(item.command).toBeUndefined();
  });
});

describe("SessionsTreeProvider.setFilter", () => {
  it("sets the omnigent.filterActive context via executeCommand", async () => {
    const opts = clientWith([{ status: 200, body: page([], { has_more: false }) }]);
    const vscode = await import("vscode");
    const spy = vi.spyOn(vscode.commands, "executeCommand");
    const p = new SessionsTreeProvider(() => opts, output);
    p.setFilter((f) => {
      f.agentName = "coder";
    });
    expect(spy).toHaveBeenCalledWith("setContext", "omnigent.filterActive", true);
    spy.mockRestore();
  });
});

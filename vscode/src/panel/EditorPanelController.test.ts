/**
 * AC14 (reconciliation) + AC15 (re-render-if-open) for EditorPanelController.
 *
 * The controller is the sole owner of the editor WebviewPanel and the only
 * navigation path. These tests use a FAKE editor WebviewPanel (createWebviewPanel
 * spy) and a REMOTE server target so the embed render path is taken — that path
 * is the one that posts {type:"omnigent/navigate"} to the panel's webview, which
 * is exactly what every entry point must drive (NOT a sidebar provider).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as vscode from "vscode";
import { EditorPanelController } from "./EditorPanelController";
import type { ServerTarget } from "../config";

const REMOTE_TARGET: ServerTarget = {
  baseUrl: "https://omni.example.com",
  origin: "https://omni.example.com",
  hostType: "remote", // forces the embed path (shouldUseIframe === false)
  source: "manual",
};

/** A fake WebviewPanel that records every message posted to its webview. */
function makeFakePanel() {
  const posted: Array<Record<string, unknown>> = [];
  let disposeCb: (() => void) | undefined;
  const panel = {
    webview: {
      html: "",
      cspSource: "vscode-resource:",
      asWebviewUri: (uri: { toString(): string }) => uri,
      postMessage: (msg: Record<string, unknown>) => {
        posted.push(msg);
        return true;
      },
    },
    reveal: vi.fn(),
    onDidDispose: (cb: () => void) => {
      disposeCb = cb;
      return { dispose: () => {} };
    },
    dispose: vi.fn(() => disposeCb?.()),
  };
  return { panel, posted };
}

function makeController() {
  const extensionUri = vscode.Uri.parse("file:///ext") as unknown as vscode.Uri;
  const output = { appendLine: () => {} } as unknown as vscode.OutputChannel;
  return new EditorPanelController(extensionUri, output);
}

describe("EditorPanelController", () => {
  let fake: ReturnType<typeof makeFakePanel>;
  // spyOn's key constraint excludes createWebviewPanel under @types/vscode, so
  // createWebviewPanel is replaced on the mock object directly with a plain mock fn.
  let createSpy: ReturnType<typeof vi.fn<unknown[], unknown>>;

  beforeEach(() => {
    fake = makeFakePanel();
    const win = vscode.window as unknown as Record<string, unknown>;
    createSpy = vi.fn<unknown[], unknown>(() => fake.panel);
    win.createWebviewPanel = createSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("AC14: navigate posts omnigent/navigate to THIS editor panel's webview (openSession path)", () => {
    const controller = makeController();
    controller.setResolved(REMOTE_TARGET);

    controller.navigate("/c/conv_abc");

    // Exactly one panel was created (the editor panel) and it was navigated.
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(fake.posted).toContainEqual({ type: "omnigent/navigate", route: "/c/conv_abc" });
  });

  it("AC14: openSessionFromTree-style navigate reuses the same panel and posts to it", () => {
    const controller = makeController();
    controller.setResolved(REMOTE_TARGET);

    // First navigation (e.g. openSession), then a tree-driven navigation.
    controller.navigate("/c/conv_first");
    fake.posted.length = 0;
    controller.navigate("/c/conv_second");

    // No second panel created — the existing editor panel is reused & revealed.
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(fake.panel.reveal).toHaveBeenCalled();
    expect(fake.posted).toContainEqual({ type: "omnigent/navigate", route: "/c/conv_second" });
  });

  it("AC15: opening the panel before setResolved, then setResolved, (re-)renders it", () => {
    const controller = makeController();

    // Panel opened during the async auth window — no resolved target yet.
    controller.ensure();
    expect(controller.isOpen()).toBe(true);
    const htmlBefore = fake.panel.webview.html;
    expect(htmlBefore).toContain("Resolving"); // placeholder

    // Resolution arrives → the already-open panel must be re-rendered.
    controller.setResolved(REMOTE_TARGET);
    // Embed path posts the init handshake to the now-resolved panel.
    expect(fake.posted).toContainEqual(
      expect.objectContaining({ type: "omnigent/init", serverUrl: REMOTE_TARGET.baseUrl }),
    );
    // Still the same single panel.
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it("ensure() preserves an already-navigated route on reveal (C2)", () => {
    const controller = makeController();
    controller.setResolved(REMOTE_TARGET);
    controller.navigate("/c/conv_route");
    fake.posted.length = 0;

    // A bare ensure() (e.g. omnigent.open) must not reset route to "/".
    controller.ensure();

    const init = fake.posted.find((m) => m.type === "omnigent/init");
    expect(init?.route).toBe("/c/conv_route");
  });

  it("dispose() disposes the panel and nulls the ref; onDidDispose does not double-clear", () => {
    const controller = makeController();
    controller.setResolved(REMOTE_TARGET);
    controller.ensure();
    expect(controller.isOpen()).toBe(true);

    controller.dispose();
    expect(fake.panel.dispose).toHaveBeenCalled();
    expect(controller.isOpen()).toBe(false);
  });
});

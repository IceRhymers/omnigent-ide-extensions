/**
 * Unit tests for the pure helpers in panel/host.ts (render decision + placeholder).
 */
import { describe, it, expect } from "vitest";
import * as vscode from "vscode";
import { shouldUseIframe, renderResolvingHtml, renderInto } from "./host";
import type { ServerTarget } from "../config";

function target(hostType: ServerTarget["hostType"]): ServerTarget {
  return {
    baseUrl: "http://127.0.0.1:6767",
    origin: "http://127.0.0.1:6767",
    hostType,
    source: "discovered",
  };
}

describe("shouldUseIframe", () => {
  it("uses iframe for a local server in iframe mode", () => {
    expect(shouldUseIframe("iframe", target("local"))).toBe(true);
  });
  it("falls back to embed for a remote server even in iframe mode (token security)", () => {
    expect(shouldUseIframe("iframe", target("remote"))).toBe(false);
  });
  it("falls back to embed for an unknown host", () => {
    expect(shouldUseIframe("iframe", target("unknown"))).toBe(false);
  });
  it("never uses iframe when renderMode is embed", () => {
    expect(shouldUseIframe("embed", target("local"))).toBe(false);
  });
});

describe("renderResolvingHtml", () => {
  it("is a self-contained placeholder with a CSP and no scripts", () => {
    const html = renderResolvingHtml();
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("Resolving Omnigent server");
    expect(html).not.toContain("<script");
  });
});

describe("renderInto (embed asset URIs)", () => {
  // Fake webview: asWebviewUri is identity (Uri mock carries a toString), so the
  // emitted href is the joined media/ path — enough to assert the relative layout.
  function fakeWebview() {
    return {
      html: "",
      asWebviewUri: (uri: { toString(): string }) => uri,
      postMessage: () => true,
      cspSource: "vscode-resource:",
    };
  }

  it("points the stylesheet at the dist-embed root, NOT assets/ (regression: 404 unstyled mount)", () => {
    const webview = fakeWebview();
    renderInto(webview as unknown as vscode.Webview, {
      target: target("remote"),
      extensionUri: vscode.Uri.parse("/ext") as unknown as vscode.Uri,
      renderMode: "embed",
      isDarkMode: true,
    });
    expect(webview.html).toContain("apweb/omnigent-embed.css");
    expect(webview.html).not.toContain("apweb/assets/omnigent-embed.css");
    // The entry + vendor bundles resolve to their real on-disk locations too.
    expect(webview.html).toContain("apweb/omnigent-embed.js");
    expect(webview.html).toContain("apweb/vendor/react.js");
  });
});

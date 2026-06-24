/**
 * Unit tests for buildIframeHtml — pure host HTML for the default iframe render mode.
 */
import { describe, it, expect } from "vitest";
import { buildIframeHtml } from "./iframeHtml";

const NONCE = "test-nonce-frame";
const CSP = "default-src 'none'; frame-src http://127.0.0.1:6767";

const baseOpts = {
  serverUrl: "http://127.0.0.1:6767",
  csp: CSP,
  nonce: NONCE,
};

describe("buildIframeHtml", () => {
  it("includes a CSP meta tag", () => {
    expect(buildIframeHtml(baseOpts)).toContain('http-equiv="Content-Security-Policy"');
  });

  it("renders an iframe pointed at the server URL", () => {
    const html = buildIframeHtml(baseOpts);
    expect(html).toContain('id="omnigent-frame"');
    expect(html).toContain('src="http://127.0.0.1:6767"');
  });

  it("strips a trailing slash from the server URL", () => {
    const html = buildIframeHtml({ ...baseOpts, serverUrl: "http://127.0.0.1:6767/" });
    expect(html).toContain('src="http://127.0.0.1:6767"');
    expect(html).not.toContain('src="http://127.0.0.1:6767/"');
  });

  it("stamps the nonce on the style and shim script", () => {
    const html = buildIframeHtml(baseOpts);
    expect(html).toContain(`<style nonce="${NONCE}">`);
    expect(html).toContain(`<script nonce="${NONCE}">`);
  });

  it("shim acquires the vscode api and handles omnigent/navigate", () => {
    const html = buildIframeHtml(baseOpts);
    expect(html).toContain("acquireVsCodeApi()");
    expect(html).toContain('omnigent/navigate');
    // Navigation sets iframe.src to serverUrl + route.
    expect(html).toContain("frame.src = serverUrl");
  });

  it("never injects a token into the iframe URL", () => {
    const html = buildIframeHtml(baseOpts);
    expect(html.toLowerCase()).not.toContain("token");
    expect(html).not.toContain("Authorization");
  });

  it("escapes attribute-breaking quotes in the iframe src attribute", () => {
    const html = buildIframeHtml({ ...baseOpts, serverUrl: 'http://x"y' });
    // The src attribute value must not contain a raw double quote that closes it early.
    expect(html).not.toContain('src="http://x"y"');
    expect(html).toContain("&quot;");
  });

  it("has a root div filling the pane", () => {
    expect(buildIframeHtml(baseOpts)).toContain('<div id="root">');
  });
});

/**
 * Unit tests for buildIframeHtml — pure host HTML for the default iframe render mode.
 */
import { describe, it, expect } from "vitest";
import { buildIframeHtml } from "./iframeHtml";

const NONCE = "test-nonce-frame";
const CSP = "default-src 'none'; frame-src http://127.0.0.1:6767";

const baseOpts = {
  baseUrl: "http://127.0.0.1:6767",
  csp: CSP,
  nonce: NONCE,
};

describe("buildIframeHtml", () => {
  it("includes a CSP meta tag", () => {
    expect(buildIframeHtml(baseOpts)).toContain('http-equiv="Content-Security-Policy"');
  });

  it("renders an iframe pointed at the base URL when no route is given", () => {
    const html = buildIframeHtml(baseOpts);
    expect(html).toContain('id="omnigent-frame"');
    expect(html).toContain('src="http://127.0.0.1:6767"');
  });

  it("bakes the initial route into the iframe src", () => {
    const html = buildIframeHtml({ ...baseOpts, route: "/c/conv_abc" });
    expect(html).toContain('src="http://127.0.0.1:6767/c/conv_abc"');
  });

  it("treats route '/' as the bare base (no trailing slash)", () => {
    const html = buildIframeHtml({ ...baseOpts, route: "/" });
    expect(html).toContain('src="http://127.0.0.1:6767"');
    expect(html).not.toContain('src="http://127.0.0.1:6767/"');
  });

  it("strips a trailing slash from the base URL", () => {
    const html = buildIframeHtml({ ...baseOpts, baseUrl: "http://127.0.0.1:6767/" });
    expect(html).toContain('src="http://127.0.0.1:6767"');
    expect(html).not.toContain('src="http://127.0.0.1:6767/"');
  });

  it("stamps the nonce on the style and shim script", () => {
    const html = buildIframeHtml(baseOpts);
    expect(html).toContain(`<style nonce="${NONCE}">`);
    expect(html).toContain(`<script nonce="${NONCE}">`);
  });

  it("shim acquires the vscode api and handles omnigent/navigate via the BARE base", () => {
    const html = buildIframeHtml({ ...baseOpts, route: "/c/conv_abc" });
    expect(html).toContain("acquireVsCodeApi()");
    expect(html).toContain("omnigent/navigate");
    // The navigate handler must append the route to the bare base, NOT to the
    // route-bearing initial src — otherwise navigation doubles the path.
    expect(html).toContain('var baseUrl = "http://127.0.0.1:6767"');
    expect(html).toContain("baseUrl.replace(/\\/$/, \"\") + msg.route");
  });

  it("regression: navigate shim base never carries the initial route (no /c/x/c/x)", () => {
    // With an initial conversation route, the shim's base must still be bare so a
    // subsequent omnigent/navigate produces base + route, never base+route + route.
    const html = buildIframeHtml({ ...baseOpts, route: "/c/conv_abc" });
    expect(html).not.toContain('var baseUrl = "http://127.0.0.1:6767/c/conv_abc"');
  });

  it("never injects a token into the iframe URL", () => {
    const html = buildIframeHtml(baseOpts);
    expect(html.toLowerCase()).not.toContain("token");
    expect(html).not.toContain("Authorization");
  });

  it("escapes attribute-breaking quotes in the iframe src attribute", () => {
    const html = buildIframeHtml({ ...baseOpts, baseUrl: 'http://x"y' });
    // The src attribute value must not contain a raw double quote that closes it early.
    expect(html).not.toContain('src="http://x"y"');
    expect(html).toContain("&quot;");
  });

  it("has a root div filling the pane", () => {
    expect(buildIframeHtml(baseOpts)).toContain('<div id="root">');
  });

  it("delegates clipboard permission to the iframe so copy/paste works in the webview", () => {
    const html = buildIframeHtml(baseOpts);
    expect(html).toContain('allow="clipboard-read; clipboard-write"');
  });
});

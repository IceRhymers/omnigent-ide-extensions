/**
 * A6 HTML unit tests — verifies import-map structure, CSS link, and module script tag.
 */
import { describe, it, expect } from "vitest";
import { buildWebviewHtml, type ImportMapUris } from "./html";

const NONCE = "test-nonce-xyz";
const CSP = "default-src 'none'; script-src 'nonce-test-nonce-xyz'";

const importMap: ImportMapUris = {
  react: "vscode-resource://media/apweb/vendor/react.js",
  reactDom: "vscode-resource://media/apweb/vendor/react-dom.js",
  reactDomClient: "vscode-resource://media/apweb/vendor/react-dom-client.js",
  reactJsxRuntime: "vscode-resource://media/apweb/vendor/jsx-runtime.js",
  reactRouter: "vscode-resource://media/apweb/vendor/react-router.js",
  reactRouterDom: "vscode-resource://media/apweb/vendor/react-router-dom.js",
  omnigentEmbed: "vscode-resource://media/apweb/omnigent-embed.js",
};

const baseOpts = {
  csp: CSP,
  nonce: NONCE,
  bootstrapUri: "vscode-resource://media/bootstrap/bootstrap.js",
  cssUri: "vscode-resource://media/apweb/assets/omnigent-embed.css",
  importMap,
  isDarkMode: false,
};

describe("buildWebviewHtml", () => {
  it("includes a CSP meta tag", () => {
    const html = buildWebviewHtml(baseOpts);
    expect(html).toContain("http-equiv=\"Content-Security-Policy\"");
  });

  it("bootstrap script is type=module", () => {
    const html = buildWebviewHtml(baseOpts);
    expect(html).toContain('type="module"');
    expect(html).toContain("bootstrap.js");
  });

  it("bootstrap script has the nonce attribute", () => {
    const html = buildWebviewHtml(baseOpts);
    // The module script tag must carry nonce
    expect(html).toContain(`nonce="${NONCE}"`);
  });

  it("CSS link tag is present with the nonce", () => {
    const html = buildWebviewHtml(baseOpts);
    expect(html).toContain('<link rel="stylesheet"');
    expect(html).toContain("omnigent-embed.css");
  });

  it("import-map script tag is present with type=importmap", () => {
    const html = buildWebviewHtml(baseOpts);
    expect(html).toContain('type="importmap"');
  });

  it("import-map contains all 6 bare-specifier keys", () => {
    const html = buildWebviewHtml(baseOpts);
    expect(html).toContain('"react"');
    expect(html).toContain('"react-dom"');
    expect(html).toContain('"react-dom/client"');
    expect(html).toContain('"react/jsx-runtime"');
    expect(html).toContain('"react-router"');
    expect(html).toContain('"react-router-dom"');
  });

  it("import-map contains omnigent-embed key", () => {
    const html = buildWebviewHtml(baseOpts);
    expect(html).toContain('"omnigent-embed"');
    expect(html).toContain("omnigent-embed.js");
  });

  it("import-map URIs match the provided importMap values", () => {
    const html = buildWebviewHtml(baseOpts);
    expect(html).toContain("vendor/react.js");
    expect(html).toContain("vendor/react-dom.js");
    expect(html).toContain("vendor/react-dom-client.js");
    expect(html).toContain("vendor/jsx-runtime.js");
    expect(html).toContain("vendor/react-router.js");
    expect(html).toContain("vendor/react-router-dom.js");
  });

  it("dark mode sets vscode-dark body class", () => {
    const html = buildWebviewHtml({ ...baseOpts, isDarkMode: true });
    expect(html).toContain('class="vscode-dark"');
  });

  it("light mode sets vscode-light body class", () => {
    const html = buildWebviewHtml({ ...baseOpts, isDarkMode: false });
    expect(html).toContain('class="vscode-light"');
  });

  it("has a root div for React mount", () => {
    const html = buildWebviewHtml(baseOpts);
    expect(html).toContain('<div id="root">');
  });
});

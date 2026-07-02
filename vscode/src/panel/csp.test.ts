/**
 * A5/A6 CSP unit tests — guards PM2 (connect-src must include wss: + the resolved WS origin).
 * A6 additions: wasm-unsafe-eval in script-src, worker-src blob: for Monaco workers.
 */
import { describe, it, expect } from "vitest";
import { buildCsp, wsOriginsForServer } from "./csp";

describe("wsOriginsForServer", () => {
  it("local http -> ws", () => {
    expect(wsOriginsForServer("http://127.0.0.1:6767")).toEqual(["ws://127.0.0.1:6767"]);
  });
  it("remote https -> wss", () => {
    expect(wsOriginsForServer("https://omnigent.example.com")).toEqual([
      "wss://omnigent.example.com",
    ]);
  });
  it("invalid url -> empty array", () => {
    expect(wsOriginsForServer("not-a-url")).toEqual([]);
  });
});

describe("buildCsp (PM2 guard)", () => {
  const base = {
    serverOrigin: "https://omnigent.example.com",
    wsOrigins: ["wss://omnigent.example.com"],
    nonce: "test-nonce-abc",
  };

  it("contains default-src none", () => {
    expect(buildCsp(base)).toContain("default-src 'none'");
  });

  it("script-src uses nonce only (no unsafe-inline in script-src directive)", () => {
    const csp = buildCsp(base);
    expect(csp).toContain("'nonce-test-nonce-abc'");
    // Extract the script-src directive only and confirm it has no unsafe-inline.
    const scriptDirective = csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
    expect(scriptDirective).not.toContain("'unsafe-inline'");
  });

  it("script-src includes wasm-unsafe-eval (Monaco wasm runtime)", () => {
    const csp = buildCsp(base);
    const scriptDirective = csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
    expect(scriptDirective).toContain("'wasm-unsafe-eval'");
  });

  it("frame-src allows the server origin (iframe render mode)", () => {
    const csp = buildCsp(base);
    const frameDirective = csp.split(";").find((d) => d.trim().startsWith("frame-src")) ?? "";
    expect(frameDirective).toContain("https://omnigent.example.com");
    expect(frameDirective).not.toContain("'none'");
  });

  it("connect-src includes the server origin (PM2)", () => {
    const csp = buildCsp(base);
    expect(csp).toContain("https://omnigent.example.com");
  });

  it("connect-src includes wss: WS origin (PM2 core assertion)", () => {
    const csp = buildCsp(base);
    expect(csp).toContain("wss://omnigent.example.com");
  });

  it("connect-src includes cspSource so the webview can fetch its own resources (dev sourcemaps)", () => {
    const csp = buildCsp({ ...base, cspSource: "vscode-webview-resource:" });
    const connectDirective = csp.split(";").find((d) => d.trim().startsWith("connect-src")) ?? "";
    expect(connectDirective).toContain("vscode-webview-resource:");
    // still includes the server + ws origins
    expect(connectDirective).toContain("https://omnigent.example.com");
    expect(connectDirective).toContain("wss://omnigent.example.com");
  });

  it("connect-src includes additional managed-sandbox WS origin (R9)", () => {
    const csp = buildCsp({
      ...base,
      wsOrigins: ["wss://omnigent.example.com", "wss://sandbox-abc.modal.run"],
    });
    expect(csp).toContain("wss://omnigent.example.com");
    expect(csp).toContain("wss://sandbox-abc.modal.run");
  });

  it("connect-src covers local ws: origin (PM2 local path)", () => {
    const csp = buildCsp({
      serverOrigin: "http://127.0.0.1:6767",
      wsOrigins: ["ws://127.0.0.1:6767"],
      nonce: "n",
    });
    expect(csp).toContain("ws://127.0.0.1:6767");
    expect(csp).toContain("http://127.0.0.1:6767");
  });

  it("cspSource is included in script-src when provided", () => {
    const csp = buildCsp({ ...base, cspSource: "vscode-resource:" });
    expect(csp).toContain("vscode-resource:");
  });

  it("worker-src includes blob: (Monaco workers)", () => {
    const csp = buildCsp(base);
    const workerDirective = csp.split(";").find((d) => d.trim().startsWith("worker-src")) ?? "";
    expect(workerDirective).toContain("blob:");
  });

  it("worker-src includes cspSource when provided", () => {
    const csp = buildCsp({ ...base, cspSource: "vscode-webview-resource:" });
    const workerDirective = csp.split(";").find((d) => d.trim().startsWith("worker-src")) ?? "";
    expect(workerDirective).toContain("vscode-webview-resource:");
    expect(workerDirective).toContain("blob:");
  });

  it("img-src includes https: for remote images", () => {
    const csp = buildCsp(base);
    const imgDirective = csp.split(";").find((d) => d.trim().startsWith("img-src")) ?? "";
    expect(imgDirective).toContain("https:");
    expect(imgDirective).toContain("data:");
  });

  it("font-src includes data: for the embed's inlined fonts", () => {
    // The ap-web embed bundle ships its (icon) fonts as data:font/woff URIs;
    // font-src must allow data: or the strict webview CSP blocks them.
    const withSource = buildCsp({ ...base, cspSource: "vscode-webview-resource:" });
    const fontDirective =
      withSource.split(";").find((d) => d.trim().startsWith("font-src")) ?? "";
    expect(fontDirective).toContain("data:");
    expect(fontDirective).toContain("vscode-webview-resource:");

    // Even without a cspSource (test/headless), data: must be present.
    const withoutSource = buildCsp(base);
    const bareFontDirective =
      withoutSource.split(";").find((d) => d.trim().startsWith("font-src")) ?? "";
    expect(bareFontDirective).toContain("data:");
    expect(bareFontDirective).not.toContain("'none'");
  });
});

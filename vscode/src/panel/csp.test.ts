/**
 * A5 CSP unit tests — guards PM2 (connect-src must include wss: + the resolved WS origin).
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

  it("frame-src is none (PM2: no iframe)", () => {
    expect(buildCsp(base)).toContain("frame-src 'none'");
  });

  it("connect-src includes the server origin (PM2)", () => {
    const csp = buildCsp(base);
    expect(csp).toContain("https://omnigent.example.com");
  });

  it("connect-src includes wss: WS origin (PM2 core assertion)", () => {
    const csp = buildCsp(base);
    expect(csp).toContain("wss://omnigent.example.com");
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
});

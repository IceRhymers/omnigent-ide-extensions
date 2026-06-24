/**
 * Unit tests for the pure helpers in panel/host.ts (render decision + placeholder).
 */
import { describe, it, expect } from "vitest";
import { shouldUseIframe, renderResolvingHtml } from "./host";
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

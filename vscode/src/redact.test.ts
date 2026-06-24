import { describe, it, expect } from "vitest";
import { redact, redactBearer, redactObject } from "./redact";

describe("redact", () => {
  it("masks a present secret and never returns it", () => {
    expect(redact("super-secret-jwt")).toBe("<redacted>");
  });
  it("reports absence for empty/null/undefined", () => {
    expect(redact("")).toBe("<none>");
    expect(redact(null)).toBe("<none>");
    expect(redact(undefined)).toBe("<none>");
  });
});

describe("redactBearer", () => {
  it("masks a bearer token embedded in a string", () => {
    const out = redactBearer("Authorization: Bearer eyJ.abc.def");
    expect(out).toBe("Authorization: Bearer <redacted>");
    expect(out).not.toContain("eyJ.abc.def");
  });
});

describe("redactObject", () => {
  it("masks token-bearing keys, preserves others", () => {
    const out = redactObject({ baseUrl: "http://x", token: "secret", hostType: "local" });
    expect(out).toEqual({ baseUrl: "http://x", token: "<redacted>", hostType: "local" });
  });
});

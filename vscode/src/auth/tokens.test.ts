import { describe, it, expect } from "vitest";
import { resolveTokenForOrigin, TokenStore } from "./tokens";
import { loadVectors } from "../test/vectors";

interface AuthTokenVectors {
  cases: Array<{
    name: string;
    input: { origin: string; tokens: TokenStore };
    expected: Record<string, unknown>;
  }>;
}

describe("resolveTokenForOrigin (conformance: auth-tokens.json)", () => {
  const vectors = loadVectors<AuthTokenVectors>("auth-tokens.json");

  for (const c of vectors.cases) {
    it(c.name, () => {
      const result = resolveTokenForOrigin(c.input.tokens, c.input.origin);
      // Compare only the fields the vector asserts (drop undefined optionals).
      const pruned = JSON.parse(JSON.stringify(result));
      expect(pruned).toEqual(c.expected);
    });
  }
});

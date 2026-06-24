import { describe, it, expect } from "vitest";
import { resolvePrecedence } from "./precedence";
import { loadVectors } from "../test/vectors";

interface PrecedenceVectors {
  cases: Array<{
    name: string;
    input: {
      manualToken: string | null;
      fileResolution: { kind: string; token?: string; workspaceHost?: string };
    };
    expected: Record<string, unknown>;
  }>;
}

describe("resolvePrecedence (conformance: token-precedence.json)", () => {
  const vectors = loadVectors<PrecedenceVectors>("token-precedence.json");

  for (const c of vectors.cases) {
    it(c.name, () => {
      const result = resolvePrecedence(
        c.input.manualToken,
        c.input.fileResolution as never,
      );
      expect(result).toEqual(c.expected);
    });
  }
});

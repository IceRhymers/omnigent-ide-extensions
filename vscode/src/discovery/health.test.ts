import { describe, it, expect } from "vitest";
import { interpretHealth, HealthObservation, HealthOutcome } from "./health";
import { loadVectors } from "../test/vectors";

interface HealthVectors {
  timeoutMs: number;
  cases: Array<{
    name: string;
    input: HealthObservation;
    expected: { outcome: HealthOutcome };
  }>;
}

describe("interpretHealth (conformance: health.json)", () => {
  const vectors = loadVectors<HealthVectors>("health.json");

  for (const c of vectors.cases) {
    it(c.name, () => {
      expect(interpretHealth(c.input)).toBe(c.expected.outcome);
    });
  }
});

import { describe, it, expect } from "vitest";
import { mapHttpStatus, HttpAuthOutcome } from "./httpStatus";
import { loadVectors } from "../test/vectors";

interface HttpStatusVectors {
  cases: Array<{
    name: string;
    input: { status: number };
    expected: { outcome: HttpAuthOutcome };
  }>;
}

describe("mapHttpStatus (conformance: http-status.json)", () => {
  const vectors = loadVectors<HttpStatusVectors>("http-status.json");

  for (const c of vectors.cases) {
    it(c.name, () => {
      expect(mapHttpStatus(c.input.status)).toBe(c.expected.outcome);
    });
  }
});

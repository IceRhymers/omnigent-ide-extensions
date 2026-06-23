import { describe, it, expect } from "vitest";
import { parsePidfile, PidfileResult } from "./pidfile";
import { loadVectors } from "../test/vectors";

interface PidfileVectors {
  cases: Array<{
    name: string;
    input: { content: string; pidAlive: boolean };
    expected: Partial<PidfileResult> & { status: string; reason?: string };
  }>;
}

describe("parsePidfile (conformance: pidfile.json)", () => {
  const vectors = loadVectors<PidfileVectors>("pidfile.json");

  for (const c of vectors.cases) {
    it(c.name, () => {
      const result = parsePidfile(c.input.content, c.input.pidAlive);
      expect(result).toEqual(c.expected);
    });
  }
});

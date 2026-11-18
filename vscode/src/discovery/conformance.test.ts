import { describe, it, expect } from "vitest";
import { interpretHealth, type HealthObservation, type HealthOutcome } from "./health";
import { parsePidfile, type PidfileResult } from "./pidfile";
import { loadVectors } from "../test/vectors";

interface PidfileVectors {
  cases: Array<{
    name: string;
    input: { content: string; pidAlive: boolean };
    expected: Partial<PidfileResult> & { status: string; reason?: string };
  }>;
}

interface HealthVectors {
  cases: Array<{
    name: string;
    input: HealthObservation;
    expected: { outcome: HealthOutcome };
  }>;
}

describe("parsePidfile (conformance: pidfile.json)", () => {
  for (const c of loadVectors<PidfileVectors>("pidfile.json").cases) {
    it(c.name, () => {
      expect(parsePidfile(c.input.content, c.input.pidAlive)).toEqual(c.expected);
    });
  }
});

describe("interpretHealth (conformance: health.json)", () => {
  for (const c of loadVectors<HealthVectors>("health.json").cases) {
    it(c.name, () => {
      expect(interpretHealth(c.input)).toBe(c.expected.outcome);
    });
  }
});

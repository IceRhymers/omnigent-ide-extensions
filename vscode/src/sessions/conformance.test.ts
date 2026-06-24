import { describe, it, expect } from "vitest";
import { matchesFilter, isFilterActive, type SessionFilter } from "./filter";
import { sortSessions, computeSignature, relativeTime } from "./treeItem";
import type { Session } from "../api/client";
import { loadVectors } from "../test/vectors";

/**
 * Cross-language conformance gate (parity with the Kotlin
 * ConformanceTest.sessionFilter @TestFactory). Loads the SAME
 * docs/conformance/session-filter.json and asserts the TS implementations of
 * the PORTABLE contracts produce the vector's `expected`. Proves the vector is
 * normative for BOTH languages, not just a Kotlin transcription.
 *
 * Path-casing (normalizeWorkspacePath) and icon mapping (statusThemeIconId) are
 * deliberately EXCLUDED from this shared vector and tested in filter.test.ts /
 * treeItem.test.ts as language-local, platform-pinned cases.
 */
interface Case {
  name: string;
  fn: "matchesFilter" | "isFilterActive" | "sortSessions" | "computeSignature" | "relativeTime";
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
}
interface SessionFilterVectors {
  description: string;
  cases: Case[];
}

describe("sessions conformance (session-filter.json)", () => {
  const vectors = loadVectors<SessionFilterVectors>("session-filter.json");

  for (const c of vectors.cases) {
    it(c.name, () => {
      switch (c.fn) {
        case "matchesFilter": {
          const s = c.input.session as Session;
          const f = c.input.filter as SessionFilter;
          expect(matchesFilter(s, f)).toBe(c.expected.matches);
          break;
        }
        case "isFilterActive": {
          const f = c.input.filter as SessionFilter;
          expect(isFilterActive(f)).toBe(c.expected.active);
          break;
        }
        case "sortSessions": {
          const sessions = c.input.sessions as Session[];
          expect(sortSessions(sessions).map((s) => s.id)).toEqual(c.expected.order);
          break;
        }
        case "computeSignature": {
          const state = c.input.state as string;
          const sessions = c.input.sessions as Session[];
          expect(computeSignature(state, sessions)).toBe(c.expected.signature);
          break;
        }
        case "relativeTime": {
          const unixSecs = c.input.unixSecs as number;
          const nowMs = c.input.nowMs as number;
          expect(relativeTime(unixSecs, nowMs)).toBe(c.expected.text);
          break;
        }
        default:
          throw new Error(`unknown fn ${(c as Case).fn}`);
      }
    });
  }
});

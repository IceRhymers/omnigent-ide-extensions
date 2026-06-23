import { describe, it, expect } from "vitest";
import { transition, LifecycleState, LifecycleEvent } from "./lifecycle";
import { loadVectors } from "../test/vectors";

interface LifecycleVectors {
  scenarios: Array<{
    name: string;
    initialState: LifecycleState;
    transitions: Array<{ event: LifecycleEvent; expectedState: LifecycleState }>;
  }>;
}

describe("auth lifecycle transition (conformance: auth-lifecycle.json)", () => {
  const vectors = loadVectors<LifecycleVectors>("auth-lifecycle.json");

  for (const scenario of vectors.scenarios) {
    it(scenario.name, () => {
      let state = scenario.initialState;
      for (const step of scenario.transitions) {
        state = transition(state, step.event);
        expect(state).toBe(step.expectedState);
      }
    });
  }
});

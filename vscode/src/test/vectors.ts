/**
 * Loads the language-neutral conformance vectors from docs/conformance/, which
 * the IntelliJ plugin's tests run as well, so both IDEs discover a local server
 * the same way.
 *
 * The conformance dir is located by walking up from the current working
 * directory until `docs/conformance` is found. This avoids `import.meta`
 * (incompatible with the CommonJS `tsc` graph) and works whether vitest runs
 * from the `vscode/` package dir or the repo root.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

function findConformanceDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "docs", "conformance");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error("could not locate docs/conformance from " + process.cwd());
}

export function loadVectors<T = unknown>(name: string): T {
  const path = join(findConformanceDir(), name);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

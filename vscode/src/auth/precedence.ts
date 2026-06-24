/**
 * Token precedence (contract §3): manual setting > file bearer > databricks
 * pointer > none. Pure. Conformance: docs/conformance/token-precedence.json.
 */
import type { FileResolution } from "./tokens";

export type ResolvedToken =
  | { source: "manual"; token: string }
  | { source: "file"; token: string }
  | { source: "databricks-pointer"; workspaceHost: string }
  | { source: "none" };

/**
 * Apply precedence. `manualToken` is the `omnigent.token` setting (may be null
 * or empty). `fileResolution` is the result of resolveTokenForOrigin().
 */
export function resolvePrecedence(
  manualToken: string | null | undefined,
  fileResolution: Pick<FileResolution, "kind"> &
    Partial<{ token: string; workspaceHost: string }>,
): ResolvedToken {
  if (manualToken !== null && manualToken !== undefined && manualToken !== "") {
    return { source: "manual", token: manualToken };
  }
  if (fileResolution.kind === "bearer" && typeof fileResolution.token === "string") {
    return { source: "file", token: fileResolution.token };
  }
  if (
    fileResolution.kind === "databricks-pointer" &&
    typeof fileResolution.workspaceHost === "string"
  ) {
    return { source: "databricks-pointer", workspaceHost: fileResolution.workspaceHost };
  }
  return { source: "none" };
}

/** Build the Authorization header for a resolved token, or none. */
export function authHeader(resolved: ResolvedToken): { Authorization: string } | undefined {
  if (resolved.source === "manual" || resolved.source === "file") {
    return { Authorization: `Bearer ${resolved.token}` };
  }
  return undefined;
}

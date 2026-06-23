/**
 * CLI login boundary (contract §6).
 *
 * Login is a documented function boundary, NOT executed in unit tests. We
 * detect CLI presence first; on absence the caller falls back to the manual
 * server-URL + token override. A CLI is never hard-required (R4).
 */

/** The command spec for a login, computed purely (no spawning). */
export interface LoginCommand {
  /** The CLI to invoke ("omnigent" or "databricks"). */
  bin: string;
  args: string[];
}

/** `omnigent login <url>` for a normal omnigent server with no usable token. */
export function omnigentLoginCommand(serverUrl: string): LoginCommand {
  return { bin: "omnigent", args: ["login", serverUrl] };
}

/** `databricks auth login` when a Databricks pointer/workspace host is targeted. */
export function databricksLoginCommand(workspaceHost?: string): LoginCommand {
  const args = ["auth", "login"];
  if (workspaceHost) {
    args.push("--host", workspaceHost);
  }
  return { bin: "databricks", args };
}

/**
 * Injectable presence check so callers (and tests) don't shell out. The runtime
 * implementation resolves the binary on PATH; default returns false so nothing
 * is assumed available in tests.
 */
export type CliPresenceCheck = (bin: string) => boolean | Promise<boolean>;

export async function isCliAvailable(
  bin: string,
  check: CliPresenceCheck,
): Promise<boolean> {
  return Boolean(await check(bin));
}

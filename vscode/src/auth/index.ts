/**
 * Auth foundation (A4): read ~/.omnigent/auth_tokens.json (0600), resolve the
 * token for an origin honoring precedence, and expose the Authorization header.
 * The long-lived auth lifecycle and CLI login boundary live in sibling modules.
 *
 * Pure logic lives in tokens.ts / precedence.ts / httpStatus.ts / lifecycle.ts;
 * this module wires the filesystem IO behind an injectable interface.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { resolveTokenForOrigin, TokenStore, FileResolution } from "./tokens";
import { resolvePrecedence, authHeader, ResolvedToken } from "./precedence";

export * from "./tokens";
export * from "./precedence";
export * from "./httpStatus";
export * from "./lifecycle";
export * from "./cli";

export const AUTH_TOKENS_PATH = join(homedir(), ".omnigent", "auth_tokens.json");

/** Injectable IO so token resolution is testable without the real home dir. */
export interface AuthIO {
  readTokens(): Promise<TokenStore | null>;
}

export const defaultAuthIO: AuthIO = {
  async readTokens() {
    try {
      const raw = await readFile(AUTH_TOKENS_PATH, "utf8");
      return JSON.parse(raw) as TokenStore;
    } catch {
      return null;
    }
  },
};

/**
 * Resolve the effective token for an origin: read the file, match the origin,
 * then apply precedence against the manual setting. Never logs the token.
 */
export async function resolveToken(
  origin: string,
  manualToken: string | null | undefined,
  io: AuthIO = defaultAuthIO,
): Promise<{ resolved: ResolvedToken; fileResolution: FileResolution }> {
  const store = (await io.readTokens()) ?? {};
  const fileResolution = resolveTokenForOrigin(store, origin);
  const resolved = resolvePrecedence(manualToken, fileResolution);
  return { resolved, fileResolution };
}

/** Convenience: the Authorization header for an origin (or none). */
export async function resolveAuthHeader(
  origin: string,
  manualToken: string | null | undefined,
  io: AuthIO = defaultAuthIO,
): Promise<{ Authorization: string } | undefined> {
  const { resolved } = await resolveToken(origin, manualToken, io);
  return authHeader(resolved);
}

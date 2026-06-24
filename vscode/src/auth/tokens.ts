/**
 * Token resolution from ~/.omnigent/auth_tokens.json (contract §3).
 *
 * The file is a JSON object keyed by origin. Two record shapes:
 *  - normal bearer:      { token, user_id, expires_at }
 *  - databricks pointer: { auth_type: "databricks", workspace_host }  (no token)
 *
 * Pure resolution here; filesystem read lives in auth/index.ts.
 * Conformance: docs/conformance/auth-tokens.json.
 */

export interface BearerRecord {
  token: string;
  user_id?: string;
  expires_at?: number;
}

export interface DatabricksPointerRecord {
  auth_type: "databricks";
  workspace_host: string;
}

export type TokenRecord = BearerRecord | DatabricksPointerRecord | Record<string, unknown>;

export type TokenStore = Record<string, TokenRecord>;

export type FileResolution =
  | { kind: "bearer"; origin: string; token: string; userId?: string; expiresAt?: number }
  | { kind: "databricks-pointer"; origin: string; workspaceHost: string }
  | { kind: "none"; origin: string };

function isDatabricksPointer(rec: TokenRecord): rec is DatabricksPointerRecord {
  return (
    typeof rec === "object" &&
    rec !== null &&
    (rec as Record<string, unknown>).auth_type === "databricks" &&
    typeof (rec as Record<string, unknown>).workspace_host === "string"
  );
}

function isBearer(rec: TokenRecord): rec is BearerRecord {
  return (
    typeof rec === "object" &&
    rec !== null &&
    typeof (rec as Record<string, unknown>).token === "string"
  );
}

/** Resolve the record for an exact origin match. Pure. */
export function resolveTokenForOrigin(store: TokenStore, origin: string): FileResolution {
  const rec = store[origin];
  if (rec === undefined) {
    return { kind: "none", origin };
  }
  if (isDatabricksPointer(rec)) {
    return { kind: "databricks-pointer", origin, workspaceHost: rec.workspace_host };
  }
  if (isBearer(rec)) {
    return {
      kind: "bearer",
      origin,
      token: rec.token,
      userId: rec.user_id,
      expiresAt: rec.expires_at,
    };
  }
  return { kind: "none", origin };
}

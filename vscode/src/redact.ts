/**
 * Secret-redaction helpers (contract §3 "Secret hygiene").
 *
 * The bearer token is a secret. It MUST NEVER appear in logs, diagnostics, or a
 * navigable URL. Anything that may carry a token is passed through `redact()`
 * before it reaches an output channel.
 */

const REDACTED = "<redacted>";

/** Replace a present, non-empty secret with a fixed placeholder. */
export function redact(secret: string | null | undefined): string {
  if (secret === null || secret === undefined || secret === "") {
    return "<none>";
  }
  return REDACTED;
}

/**
 * Redact a bearer token that may be embedded inside an arbitrary string
 * (e.g. an `Authorization: Bearer ...` header dumped into diagnostics).
 */
export function redactBearer(value: string): string {
  return value.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`);
}

/**
 * Strip any `token`/`access_token`/`Authorization` fields from an object so it
 * can be safely logged. Returns a shallow, redacted copy.
 */
export function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (/token|authorization|secret|password/i.test(key)) {
      out[key] = redact(typeof val === "string" ? val : val == null ? null : String(val));
    } else {
      out[key] = val;
    }
  }
  return out;
}

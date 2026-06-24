/**
 * One-shot HTTP status -> auth outcome (contract §5.2).
 * Conformance: docs/conformance/http-status.json.
 *
 * 401 => reauth (refresh/re-login then retry, or prompt)
 * 403 => forbidden (authenticated but not permitted; do NOT re-login loop)
 * 2xx => ok
 * other => error
 */
export type HttpAuthOutcome = "ok" | "reauth" | "forbidden" | "error";

export function mapHttpStatus(status: number): HttpAuthOutcome {
  if (status >= 200 && status < 300) {
    return "ok";
  }
  if (status === 401) {
    return "reauth";
  }
  if (status === 403) {
    return "forbidden";
  }
  return "error";
}

package ai.omnigent.intellij.sessions

import ai.omnigent.intellij.api.Session

/**
 * Pure quiet-poll diff signature for the Sessions list (plan Phase 2).
 *
 * Produces `"state|id:updatedAt:status,..."` over the sessions in FETCHED order
 * (NOT sorted/filtered — the raw fetch order, matching the VS Code provider
 * which builds the signature from `this.sessions`). Absent `updatedAt`/`status`
 * render as the empty string. A quiet poll skips the model update when the new
 * signature equals the last, so an unchanged list never flashes the view.
 *
 * Mirrors the inline signature in vscode/src/sessions/SessionsTreeProvider.ts
 * (`${state}|${sessions.map(s => `${s.id}:${s.updated_at ?? ""}:${s.status ?? ""}`).join(",")}`).
 * NO IntelliJ-platform imports.
 */
fun computeSignature(state: String, sessions: List<Session>): String {
    val body = sessions.joinToString(",") { s ->
        "${s.id}:${s.updatedAt ?: ""}:${s.status ?: ""}"
    }
    return "$state|$body"
}

/**
 * Pure decision (plan Phase 4): should a refresh rebuild the list model?
 *
 * A non-quiet refresh (user-initiated / first load / become-visible) ALWAYS
 * rebuilds. A quiet poll rebuilds ONLY when the freshly computed [newSignature]
 * differs from [oldSignature] — so an unchanged 15s poll is a no-op and the list
 * never flashes. Factored out of the EDT-marshalling path so the diff-equality
 * contract is unit-testable without an IDE host.
 */
fun shouldUpdateModel(quiet: Boolean, oldSignature: String?, newSignature: String): Boolean =
    !quiet || newSignature != oldSignature

package ai.omnigent.intellij.actions

import ai.omnigent.intellij.SessionStateService
import ai.omnigent.intellij.api.OmnigentApiClient
import com.intellij.diff.DiffContentFactory
import com.intellij.diff.DiffManager
import com.intellij.diff.requests.SimpleDiffRequest
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.ui.Messages

/**
 * B4 — View changed files + diffs (VIEW-ONLY for all sessions).
 *
 * Lists changed files via GET /v1/sessions/{id}/resources/files, fetches
 * before/after via the resources/diff REST proxy, and renders each with the
 * native [DiffManager] using in-memory [com.intellij.diff.contents.DiffContent]
 * built by [DiffContentFactory]. Works for BOTH local and remote sessions (the
 * server proxies to the runner). Mirrors the view half of
 * vscode/src/commands/diffs.ts. Pure HTTP/parse logic lives in
 * [ai.omnigent.intellij.api.OmnigentApiClient]/OmnigentPayloads.
 */
class ViewDiffsAction : AnAction() {

    private val log = logger<ViewDiffsAction>()

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val state = SessionStateService.getInstance(project)
        val opts = state.clientOpts
        val sessionId = state.sessionId
        if (opts == null || sessionId == null) {
            Messages.showWarningDialog(project, "No active session.", "Omnigent")
            return
        }

        ApplicationManager.getApplication().executeOnPooledThread {
            val client = OmnigentApiClient(opts)
            val filesResult = client.listChangedFiles(sessionId)
            if (!filesResult.ok || filesResult.data == null) {
                ApplicationManager.getApplication().invokeLater {
                    Messages.showErrorDialog(project, "Could not list changed files (${filesResult.status}).", "Omnigent")
                }
                return@executeOnPooledThread
            }
            val files = filesResult.data
            if (files.isEmpty()) {
                ApplicationManager.getApplication().invokeLater {
                    Messages.showInfoMessage(project, "No changed files.", "Omnigent")
                }
                return@executeOnPooledThread
            }

            for (file in files) {
                val envId = file.environmentId ?: "default"
                val diff = client.fetchDiff(sessionId, envId, file.relativePath)
                val data = diff.data
                if (!diff.ok || data == null) {
                    log.info("[omnigent] diff fetch failed for ${file.relativePath}: ${diff.error}")
                    continue
                }
                ApplicationManager.getApplication().invokeLater {
                    val factory = DiffContentFactory.getInstance()
                    val before = factory.create(data.before)
                    val after = factory.create(data.after)
                    val request = SimpleDiffRequest(
                        "Omnigent diff: ${data.relativePath}",
                        before,
                        after,
                        "Before",
                        "After",
                    )
                    DiffManager.getInstance().showDiff(project, request)
                }
            }
        }
    }
}

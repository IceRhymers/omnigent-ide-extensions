package ai.omnigent.intellij.actions

import ai.omnigent.intellij.Redact
import ai.omnigent.intellij.SessionStateService
import ai.omnigent.intellij.api.OmnigentApiClient
import ai.omnigent.intellij.api.OmnigentPayloads
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.guessProjectDir
import com.intellij.openapi.ui.Messages

/**
 * B4 — Send selection/file to the active Omnigent session.
 *
 * Pure logic ([Workspace.computeSelectionPayload], [OmnigentPayloads.buildMessageEvent])
 * is unit-tested. This thin action captures the editor selection, computes the
 * workspace-relative path, builds a `message` event, and POSTs it via the HTTP
 * client. Mirrors vscode/src/commands/sendSelection.ts.
 */
class SendSelectionAction : AnAction() {

    private val log = logger<SendSelectionAction>()

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR)
        if (editor == null) {
            Messages.showInfoMessage(project, "Open a file to send a selection.", "Omnigent")
            return
        }

        val state = SessionStateService.getInstance(project)
        val opts = state.clientOpts
        if (opts == null) {
            Messages.showWarningDialog(project, "No active server connection. Open the Omnigent tool window first.", "Omnigent")
            return
        }
        val sessionId = state.sessionId
        if (sessionId == null) {
            Messages.showWarningDialog(project, "No active session. Use \"Open / Switch Session\" first.", "Omnigent")
            return
        }

        val selectedText = editor.selectionModel.selectedText ?: ""
        val virtualFile = e.getData(CommonDataKeys.VIRTUAL_FILE)
        val absolutePath = virtualFile?.path
        val workspaceRoot = project.guessProjectDir()?.path

        val payload = Workspace.computeSelectionPayload(selectedText, absolutePath, workspaceRoot)
        val event = OmnigentPayloads.buildMessageEvent(payload.content, payload.relativePath)

        log.info("[omnigent] sendSelection path=${payload.relativePath ?: "(none)"} token=${Redact.redact(opts.token)}")

        // Network IO off the EDT.
        ApplicationManager.getApplication().executeOnPooledThread {
            val result = OmnigentApiClient(opts).postSessionEvent(sessionId, event)
            if (!result.ok) {
                ApplicationManager.getApplication().invokeLater {
                    Messages.showErrorDialog(
                        project,
                        "Failed to send selection (${result.status}: ${result.error}).",
                        "Omnigent",
                    )
                }
            }
        }
    }
}

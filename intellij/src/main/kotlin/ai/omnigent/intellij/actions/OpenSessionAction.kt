package ai.omnigent.intellij.actions

import ai.omnigent.intellij.ConnectionResolver
import ai.omnigent.intellij.SessionStateService
import ai.omnigent.intellij.api.OmnigentApiClient
import ai.omnigent.intellij.config.OmnigentSettings
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.wm.ToolWindowManager

/**
 * B4 — Open/switch session + status.
 *
 * Opens/focuses the Omnigent tool window, resolves the connection, creates a
 * session (POST /v1/sessions), records it in [SessionStateService], navigates
 * the JCEF browser to `/c/:id`, and updates the connection status (state + host
 * type) shown in the tool-window title. Mirrors vscode/src/commands/openSession.ts.
 */
class OpenSessionAction : AnAction() {

    private val log = logger<OpenSessionAction>()

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val state = SessionStateService.getInstance(project)

        // Open/focus the tool window (creates the JCEF content + navigateHandler).
        ToolWindowManager.getInstance(project).getToolWindow("Omnigent")?.activate(null)

        // Resolve a connection if the tool window hasn't already.
        val opts = state.clientOpts ?: run {
            val resolved = ConnectionResolver.resolve(OmnigentSettings.getInstance().toSettings())
            if (resolved == null) {
                Messages.showWarningDialog(
                    project,
                    "No server configured. Set the Server URL in Settings → Tools → Omnigent, or start a local server.",
                    "Omnigent",
                )
                return
            }
            state.clientOpts = resolved.clientOpts
            state.hostType = resolved.target.hostType
            resolved.clientOpts
        }

        state.updateStatus(SessionStateService.ConnectionStatus.CONNECTING)
        log.info("[omnigent] openSession: creating session…")

        ApplicationManager.getApplication().executeOnPooledThread {
            val result = OmnigentApiClient(opts).createSession()
            ApplicationManager.getApplication().invokeLater {
                val id = result.data
                if (!result.ok || id == null) {
                    state.updateStatus(SessionStateService.ConnectionStatus.ERROR)
                    log.info("[omnigent] openSession failed (${result.status}: ${result.error})")
                    Messages.showErrorDialog(project, "Could not create session (${result.status}).", "Omnigent")
                    return@invokeLater
                }
                state.sessionId = id
                state.updateStatus(SessionStateService.ConnectionStatus.CONNECTED)
                log.info("[omnigent] openSession: session $id created")
                // Deep-link the JCEF browser to the session route (no iframe reload).
                state.navigate("/c/$id")
            }
        }
    }
}

package ai.omnigent.intellij.sessions.actions

import ai.omnigent.intellij.sessions.SessionsService
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent

/**
 * Toolbar action: re-fetch the session list (non-quiet). Mirrors the VS Code
 * `omnigent.sessions.refresh` command.
 */
class RefreshSessionsAction : AnAction("Refresh", "Reload the session list", AllIcons.Actions.Refresh) {

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = e.project != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        SessionsService.getInstance(project).refresh(quiet = false)
    }
}

package ai.omnigent.intellij.sessions.actions

import ai.omnigent.intellij.sessions.SessionsService
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent

/**
 * Toolbar action: flip the `hideArchived` dimension of the active filter.
 * Mirrors the VS Code `omnigent.sessions.toggleArchived` command. Reads the
 * `@Volatile` filter in [update] to reflect the current state, so it runs on BGT.
 */
class ToggleArchivedAction :
    AnAction("Toggle Archived", "Show or hide archived sessions", AllIcons.Actions.ToggleVisibility) {

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        val project = e.project
        if (project == null) {
            e.presentation.isEnabled = false
            return
        }
        e.presentation.isEnabled = true
        val hideArchived = SessionsService.getInstance(project).filter.hideArchived
        e.presentation.text = if (hideArchived) "Show Archived Sessions" else "Hide Archived Sessions"
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val service = SessionsService.getInstance(project)
        val current = service.filter
        service.applyFilter(current.copy(hideArchived = !current.hideArchived))
    }
}

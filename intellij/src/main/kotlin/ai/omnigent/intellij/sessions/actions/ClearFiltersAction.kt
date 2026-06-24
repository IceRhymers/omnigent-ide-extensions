package ai.omnigent.intellij.sessions.actions

import ai.omnigent.intellij.sessions.SessionsService
import ai.omnigent.intellij.sessions.defaultFilter
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent

/**
 * Toolbar action: reset the active filter to [defaultFilter]. Mirrors the VS
 * Code `omnigent.sessions.clearFilters` command. Disabled when no filter is
 * active (the IntelliJ analog of VS Code's `setContext omnigent.filterActive`),
 * so it reads the `@Volatile` filter state in [update] on BGT.
 */
class ClearFiltersAction :
    AnAction("Clear Filters", "Reset all session filters", AllIcons.Actions.Cancel) {

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        val project = e.project
        e.presentation.isEnabled = project != null && SessionsService.getInstance(project).isFilterActive()
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        SessionsService.getInstance(project).applyFilter(defaultFilter())
    }
}

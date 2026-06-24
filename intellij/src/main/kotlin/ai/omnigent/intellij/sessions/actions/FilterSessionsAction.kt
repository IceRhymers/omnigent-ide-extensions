package ai.omnigent.intellij.sessions.actions

import ai.omnigent.intellij.api.Session
import ai.omnigent.intellij.sessions.SessionsService
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.guessProjectDir
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.ui.popup.PopupStep
import com.intellij.openapi.ui.popup.util.BaseListPopupStep

/**
 * Toolbar action: pick a filter dimension, then a value for it — the IntelliJ
 * analog of the VS Code `omnigent.sessions.filter` QuickPick
 * (vscode/src/commands/sessionsTreeCommands.ts). Dimensions: Agent / Status /
 * Git Branch / Title contains… / Current folder only / (archived is its own
 * toggle action). Runs on the EDT (drives popups + input dialogs).
 */
class FilterSessionsAction :
    AnAction("Filter…", "Filter sessions by agent, status, branch, title, or folder", AllIcons.General.Filter) {

    private enum class Dimension(val label: String) {
        AGENT_NAME("Agent"),
        STATUS("Status"),
        GIT_BRANCH("Git Branch"),
        TITLE_QUERY("Title contains…"),
        CURRENT_FOLDER("Current folder only"),
    }

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = e.project != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val service = SessionsService.getInstance(project)

        val dimensions = Dimension.entries.toList()
        val step = object : BaseListPopupStep<Dimension>("Filter Sessions By…", dimensions) {
            override fun getTextFor(value: Dimension): String = value.label

            override fun onChosen(selectedValue: Dimension, finalChoice: Boolean): PopupStep<*>? {
                doFinalStep { chooseValue(project, service, selectedValue) }
                return PopupStep.FINAL_CHOICE
            }
        }
        JBPopupFactory.getInstance().createListPopup(step).showInFocusCenter()
    }

    /** Resolve the value for the chosen dimension and apply it to the filter. */
    private fun chooseValue(project: Project, service: SessionsService, dimension: Dimension) {
        when (dimension) {
            Dimension.TITLE_QUERY -> {
                val query = Messages.showInputDialog(
                    project,
                    "Substring to match (case-insensitive):",
                    "Filter by Title",
                    null,
                ) ?: return
                service.applyFilter(
                    service.filter.copy(titleQuery = if (query.trim().isEmpty()) null else query),
                )
            }

            Dimension.CURRENT_FOLDER -> {
                val current = service.filter
                if (current.currentFolderOnly) {
                    service.applyFilter(current.copy(currentFolderOnly = false, workspacePath = null))
                } else {
                    val folder = currentFolderPath(project)
                    if (folder == null) {
                        Messages.showInfoMessage(project, "No project folder to filter by.", "Omnigent")
                        return
                    }
                    service.applyFilter(current.copy(currentFolderOnly = true, workspacePath = folder))
                }
            }

            else -> {
                val values = distinctValues(service.sessions) { s ->
                    when (dimension) {
                        Dimension.AGENT_NAME -> s.agentName
                        Dimension.STATUS -> s.status
                        Dimension.GIT_BRANCH -> s.gitBranch
                        else -> null
                    }
                }
                if (values.isEmpty()) {
                    Messages.showInfoMessage(
                        project,
                        "No values to filter ${dimension.label.lowercase()} by.",
                        "Omnigent",
                    )
                    return
                }
                val valueStep = object : BaseListPopupStep<String>("Filter by ${dimension.label}", values) {
                    override fun onChosen(selectedValue: String, finalChoice: Boolean): PopupStep<*>? {
                        doFinalStep { applyValue(service, dimension, selectedValue) }
                        return PopupStep.FINAL_CHOICE
                    }
                }
                JBPopupFactory.getInstance().createListPopup(valueStep).showInFocusCenter()
            }
        }
    }

    private fun applyValue(service: SessionsService, dimension: Dimension, value: String) {
        val current = service.filter
        service.applyFilter(
            when (dimension) {
                Dimension.AGENT_NAME -> current.copy(agentName = value)
                Dimension.STATUS -> current.copy(status = value)
                Dimension.GIT_BRANCH -> current.copy(gitBranch = value)
                else -> current
            },
        )
    }

    /** Distinct, defined, sorted values of a session field. Mirrors the TS helper. */
    private fun distinctValues(sessions: List<Session>, pick: (Session) -> String?): List<String> {
        val seen = sortedSetOf<String>()
        for (s in sessions) {
            val v = pick(s)
            if (v != null && v.isNotEmpty()) seen.add(v)
        }
        return seen.toList()
    }

    /** Single current-folder source (plan R6/Q5): basePath, fallback guessProjectDir. */
    private fun currentFolderPath(project: Project): String? =
        project.basePath ?: project.guessProjectDir()?.path
}

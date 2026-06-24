package ai.omnigent.intellij.sessions

import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory

/**
 * Factory for the dedicated, LEFT-anchored `OmnigentSessions` tool window (plan
 * Phase 3, Option D). A SEPARATE tool window from the right-anchored `Omnigent`
 * JCEF window so the session list and the conversation are visible concurrently
 * (mirroring VS Code's sidebar + editor panel). Click-to-open in [SessionsPanel]
 * still drives the JCEF browser via `SessionStateService.navigate`.
 */
class SessionsToolWindowFactory : ToolWindowFactory, DumbAware {

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = SessionsPanel(project)
        val content = ContentFactory.getInstance().createContent(panel.component, "", false)
        toolWindow.contentManager.addContent(content)
    }
}

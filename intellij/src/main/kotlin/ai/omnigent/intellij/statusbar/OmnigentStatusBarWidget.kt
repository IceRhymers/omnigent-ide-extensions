package ai.omnigent.intellij.statusbar

import ai.omnigent.intellij.SessionStateService
import ai.omnigent.intellij.StatusLabels
import ai.omnigent.intellij.sessions.SessionsService
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.StatusBar
import com.intellij.openapi.wm.StatusBarWidget
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.util.Consumer
import java.awt.event.MouseEvent

/**
 * The SINGLE canonical connection-status surface (plan Phase 5) — the IntelliJ
 * analog of the VS Code status-bar item (vscode/src/commands/openSession.ts).
 *
 * It registers itself as the [SessionStateService.statusListener] consumer and
 * repaints on every [SessionStateService.updateStatus]. The text + tooltip
 * mirror [StatusLabels.label]/[StatusLabels.tooltip] (connection state + host
 * type, with the current session id in the tooltip).
 *
 * NOTE (single-slot constraint): [SessionStateService.statusListener] is a
 * single nullable field — exactly one registrant. This widget is that sole
 * registrant; the JCEF tool-window title no longer reflects status. Adding a
 * second status consumer would require generalizing the field to a listener list
 * first (see the plan Phase 5 note).
 */
class OmnigentStatusBarWidget(private val project: Project) :
    StatusBarWidget,
    StatusBarWidget.TextPresentation {

    private var statusBar: StatusBar? = null
    private val state = SessionStateService.getInstance(project)

    override fun ID(): String = WIDGET_ID

    override fun install(statusBar: StatusBar) {
        this.statusBar = statusBar
        // Become the sole status consumer; repaint the widget on each update.
        state.statusListener = {
            ApplicationManager.getApplication().invokeLater {
                this.statusBar?.updateWidget(WIDGET_ID)
            }
        }
    }

    override fun dispose() {
        // Release the single-slot listener only if we still own it.
        if (state.statusListener != null) {
            state.statusListener = null
        }
        statusBar = null
    }

    override fun getPresentation(): StatusBarWidget.WidgetPresentation = this

    override fun getText(): String = StatusLabels.label(state.status, state.hostType)

    override fun getAlignment(): Float = java.awt.Component.LEFT_ALIGNMENT

    override fun getTooltipText(): String =
        StatusLabels.tooltip(state.status, state.hostType, state.sessionId)

    /** Click focuses the Sessions tool window — a discoverable entry point. */
    override fun getClickConsumer(): Consumer<MouseEvent> = Consumer {
        ToolWindowManager.getInstance(project)
            .getToolWindow(SessionsService.SESSIONS_TOOL_WINDOW_ID)
            ?.activate(null)
    }

    companion object {
        const val WIDGET_ID = "ai.omnigent.intellij.StatusBarWidget"
    }
}

package ai.omnigent.intellij.statusbar

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.StatusBarWidget
import com.intellij.openapi.wm.StatusBarWidgetFactory

/**
 * Registers the [OmnigentStatusBarWidget] — the single canonical Omnigent status
 * surface (plan Phase 5). Project-scoped: each open project gets its own widget
 * bound to that project's [ai.omnigent.intellij.SessionStateService].
 */
class OmnigentStatusBarWidgetFactory : StatusBarWidgetFactory {

    override fun getId(): String = OmnigentStatusBarWidget.WIDGET_ID

    override fun getDisplayName(): String = "Omnigent"

    override fun isAvailable(project: Project): Boolean = true

    override fun createWidget(project: Project): StatusBarWidget = OmnigentStatusBarWidget(project)

    override fun disposeWidget(widget: StatusBarWidget) {
        widget.dispose()
    }

    override fun canBeEnabledOn(statusBar: com.intellij.openapi.wm.StatusBar): Boolean = true
}

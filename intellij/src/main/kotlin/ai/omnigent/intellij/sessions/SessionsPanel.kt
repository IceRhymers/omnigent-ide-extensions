package ai.omnigent.intellij.sessions

import ai.omnigent.intellij.SessionStateService
import ai.omnigent.intellij.sessions.actions.ClearFiltersAction
import ai.omnigent.intellij.sessions.actions.FilterSessionsAction
import ai.omnigent.intellij.sessions.actions.RefreshSessionsAction
import ai.omnigent.intellij.sessions.actions.ToggleArchivedAction
import com.intellij.icons.AllIcons
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.ui.ColoredListCellRenderer
import com.intellij.ui.ListSpeedSearch
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.CardLayout
import java.awt.event.KeyEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.DefaultListModel
import javax.swing.JComponent
import javax.swing.JList
import javax.swing.JPanel
import javax.swing.KeyStroke
import javax.swing.ListSelectionModel
import javax.swing.SwingUtilities

/**
 * The Sessions tool-window content (plan Phase 3): a [JBList] of
 * [SessionItemView] rows with a colored renderer (label + gray description +
 * status icon), a tooltip, type-to-filter speed-search, an [com.intellij.openapi.actionSystem.ActionToolbar]
 * (refresh / filter / toggle-archived / clear), and the click-to-open handler.
 *
 * All construction + model mutation happens on the EDT (the factory calls this
 * on the EDT). The panel registers a model-update callback on [SessionsService]
 * so off-EDT fetches marshal their applied rows here.
 */
class SessionsPanel(private val project: Project) {

    private val service = SessionsService.getInstance(project)
    private val listModel = DefaultListModel<SessionItemView>()
    private val list = JBList(listModel)
    private val root = JPanel(BorderLayout())

    /** Card layout swaps between the list and a centered status message. */
    private val cards = JPanel(CardLayout())
    private val statusLabel = com.intellij.ui.components.JBLabel("", javax.swing.SwingConstants.CENTER)

    /** Non-selectable "Showing first N" footer shown when the list is truncated. */
    private val truncatedFooter = com.intellij.ui.components.JBLabel("").apply {
        border = JBUI.Borders.empty(4, 8)
        foreground = com.intellij.util.ui.UIUtil.getContextHelpForeground()
        isVisible = false
    }

    companion object {
        private const val CARD_LIST = "list"
        private const val CARD_STATUS = "status"
        private const val NOTIFICATION_GROUP = "Omnigent"
    }

    val component: JComponent
        get() = root

    init {
        list.selectionMode = ListSelectionModel.SINGLE_SELECTION
        list.cellRenderer = SessionCellRenderer()
        list.toolTipText = null
        installTooltip()
        installSpeedSearch()
        installClickToOpen()

        cards.add(JBScrollPane(list), CARD_LIST)
        val statusPanel = JPanel(BorderLayout())
        statusLabel.border = JBUI.Borders.empty(16)
        statusPanel.add(statusLabel, BorderLayout.CENTER)
        cards.add(statusPanel, CARD_STATUS)

        root.add(buildToolbar(), BorderLayout.NORTH)
        root.add(cards, BorderLayout.CENTER)
        root.add(truncatedFooter, BorderLayout.SOUTH)

        service.modelUpdateHandler = { items -> applyModel(items) }
        showStatus("Loading…")
        service.refresh(quiet = false)
        // Phase 4: begin visible-only 15s quiet/diff polling (idempotent).
        service.startPolling()
    }

    /** Rebuild the list model from the derived rows (EDT, called by the service). */
    private fun applyModel(items: List<SessionItemView>) {
        listModel.clear()
        items.forEach { listModel.addElement(it) }
        truncatedFooter.isVisible = false
        when (service.listState) {
            SessionsService.ListState.UNAUTHORIZED -> showStatus("Not authorized (401/403) — check your token")
            SessionsService.ListState.ERROR -> showStatus("Omnigent server unreachable")
            SessionsService.ListState.LOADING -> showStatus("Loading…")
            SessionsService.ListState.LOADED -> {
                if (items.isEmpty()) {
                    showStatus(if (service.isFilterActive()) "No sessions match the active filter" else "No sessions")
                } else {
                    (cards.layout as CardLayout).show(cards, CARD_LIST)
                    if (service.truncated) {
                        // Parity "Showing first N" — N is the accumulated size, not the cap.
                        truncatedFooter.text = "Showing first ${service.sessions.size}"
                        truncatedFooter.isVisible = true
                    }
                }
            }
        }
    }

    private fun showStatus(message: String) {
        statusLabel.text = message
        truncatedFooter.isVisible = false
        (cards.layout as CardLayout).show(cards, CARD_STATUS)
    }

    private fun buildToolbar(): JComponent {
        // Prefer the plugin.xml-registered group so presentations stay consistent;
        // fall back to a code-built group if the registration is unavailable.
        val actionManager = ActionManager.getInstance()
        val group = actionManager.getAction("ai.omnigent.intellij.sessions.Toolbar") as? DefaultActionGroup
            ?: DefaultActionGroup().apply {
                add(RefreshSessionsAction())
                add(FilterSessionsAction())
                add(ToggleArchivedAction())
                add(ClearFiltersAction())
            }
        val toolbar = actionManager
            .createActionToolbar(ActionPlaces.TOOLWINDOW_CONTENT, group, true)
        // Mandatory: without a targetComponent, AnAction.update enablement does
        // not resolve and the toolbar buttons break.
        toolbar.targetComponent = root
        return toolbar.component
    }

    private fun installSpeedSearch() {
        // Static installer (NOT the deprecated constructor). The extractor MUST
        // return the derived label, not toString().
        ListSpeedSearch.installOn(list) { item -> item?.let(::deriveLabelForSpeedSearch) }
    }

    private fun installTooltip() {
        list.addMouseMotionListener(object : java.awt.event.MouseMotionAdapter() {
            override fun mouseMoved(e: MouseEvent) {
                val index = list.locationToIndex(e.point)
                list.toolTipText = if (index in 0 until listModel.size()) {
                    listModel.getElementAt(index).tooltip
                } else {
                    null
                }
            }
        })
    }

    private fun installClickToOpen() {
        list.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (e.clickCount == 2 && SwingUtilities.isLeftMouseButton(e)) {
                    list.selectedValue?.let { openSession(it.id) }
                }
            }
        })
        list.registerKeyboardAction(
            { list.selectedValue?.let { openSession(it.id) } },
            KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0),
            JComponent.WHEN_FOCUSED,
        )
    }

    /**
     * Click-to-open sequence (plan Phase 3, exact order):
     *   1. set `state.sessionId = id` FIRST — the Omnigent factory reads it at
     *      construction to compute the initial route;
     *   2. activate the `Omnigent` tool window — opens/focuses the JCEF window,
     *      which (if not yet open) registers `navigateHandler`;
     *   3. THEN navigate to `/c/$id`.
     * If the connection is unresolved (navigate would be a no-op), surface a
     * non-blocking notification instead of silently doing nothing.
     */
    private fun openSession(id: String) {
        val state = SessionStateService.getInstance(project)
        state.sessionId = id
        ToolWindowManager.getInstance(project).getToolWindow("Omnigent")?.activate(null)
        if (state.navigateHandler == null || state.clientOpts == null) {
            notifyUnresolved()
            return
        }
        state.navigate("/c/$id")
    }

    private fun notifyUnresolved() {
        NotificationGroupManager.getInstance()
            .getNotificationGroup(NOTIFICATION_GROUP)
            .createNotification(
                "Omnigent server unreachable — open the Omnigent tool window or set the Server URL in Settings → Tools → Omnigent.",
                NotificationType.WARNING,
            )
            .notify(project)
    }

    /** The colored cell: status icon + label (default) + gray description. */
    private inner class SessionCellRenderer : ColoredListCellRenderer<SessionItemView>() {
        override fun customizeCellRenderer(
            list: JList<out SessionItemView>,
            value: SessionItemView?,
            index: Int,
            selected: Boolean,
            hasFocus: Boolean,
        ) {
            if (value == null) return
            icon = iconFor(value.statusIcon)
            append(value.label, SimpleTextAttributes.REGULAR_ATTRIBUTES)
            if (value.description.isNotEmpty()) {
                append("  ${value.description}", SimpleTextAttributes.GRAYED_ATTRIBUTES)
            }
            toolTipText = value.tooltip
        }
    }
}

/**
 * Map a platform-neutral [SessionStatusIcon] to a concrete `AllIcons` instance
 * (plan Phase 3 — centralized here). Kept top-level so it has no enclosing-class
 * state and reads as the single source of the icon mapping.
 */
private fun iconFor(status: SessionStatusIcon): javax.swing.Icon = when (status) {
    SessionStatusIcon.ARCHIVED -> AllIcons.Nodes.Folder
    SessionStatusIcon.RUNNING -> AllIcons.Actions.Execute
    SessionStatusIcon.IDLE -> AllIcons.Nodes.EmptyNode
    SessionStatusIcon.ERROR -> AllIcons.General.Error
}

/** Speed-search text extractor: the DERIVED label, never toString(). */
private fun deriveLabelForSpeedSearch(item: SessionItemView): String = item.label

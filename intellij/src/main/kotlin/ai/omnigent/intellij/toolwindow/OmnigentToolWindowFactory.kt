package ai.omnigent.intellij.toolwindow

import ai.omnigent.intellij.ConnectionResolver
import ai.omnigent.intellij.Redact
import ai.omnigent.intellij.SessionStateService
import ai.omnigent.intellij.config.OmnigentSettings
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.components.JBLabel
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import java.awt.BorderLayout
import javax.swing.JPanel

/**
 * B2 — ToolWindow hosting a JCEF browser (live-navigate).
 *
 * JCEF is full in-process Chromium with same-origin `loadURL`, so we navigate
 * directly to the resolved server URL + route. WS terminals work natively — no
 * CSP work needed. We guard [JBCefApp.isSupported] (R5/PM7) and show actionable
 * guidance (switch to a JCEF-capable JBR) when unsupported.
 *
 * AUTH (Q2/R7): the served SPA is same-origin, so it uses the server's
 * cookie/session for the local single-user path (primary v1). If a bearer is
 * required for a remote server, it must be injected via JCEF request handling
 * (a CefRequestHandler adding the `Authorization` header on outgoing requests)
 * or a cookie set on the JCEF cookie manager BEFORE loadURL. The token is a
 * secret and must never be placed in a navigable URL (R3). Wiring the
 * remote-bearer request handler is tracked as Q2 and is intentionally left as a
 * documented seam below rather than implemented for v1 local.
 */
class OmnigentToolWindowFactory : ToolWindowFactory, DumbAware {

    private val log = logger<OmnigentToolWindowFactory>()

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = JPanel(BorderLayout())
        val contentFactory = ContentFactory.getInstance()

        if (!JBCefApp.isSupported()) {
            // R5/PM7: JBR without JCEF. Show actionable guidance, do not crash.
            panel.add(
                JBLabel(
                    "<html><b>Omnigent</b> requires a JCEF-capable runtime.<br><br>" +
                        "The embedded browser (JCEF) is not available in this IDE's runtime.<br>" +
                        "Switch to a <b>JetBrains Runtime (JBR) with JCEF</b>:<br>" +
                        "&nbsp;&nbsp;Help → Find Action → \"Choose Boot Java Runtime for the IDE\"<br>" +
                        "&nbsp;&nbsp;and select a JBR build that includes JCEF (the default JBR 17+ does).</html>",
                ),
                BorderLayout.CENTER,
            )
            toolWindow.contentManager.addContent(contentFactory.createContent(panel, "", false))
            return
        }

        val browser = JBCefBrowser()
        panel.add(browser.component, BorderLayout.CENTER)

        val state = SessionStateService.getInstance(project)

        // Resolve the server target (B3) and live-navigate to it.
        val settings = OmnigentSettings.getInstance().toSettings()
        val connection = ConnectionResolver.resolve(settings)
        if (connection == null) {
            log.info("[omnigent] no server target resolved (no manual override, no healthy local server)")
            browser.loadHTML(
                "<html><body style='font-family:sans-serif;padding:1rem'>" +
                    "<h3>Omnigent — no server found</h3>" +
                    "<p>No Omnigent server was auto-discovered and no manual server URL is configured.</p>" +
                    "<p>Set <code>Server URL</code> in <b>Settings → Tools → Omnigent</b>, or start a local " +
                    "Omnigent server, then reopen this tool window.</p>" +
                    "</body></html>",
            )
        } else {
            state.clientOpts = connection.clientOpts
            state.hostType = connection.target.hostType
            // Default route: existing session (/c/<id>) or the root.
            val route = state.sessionId?.let { "/c/$it" } ?: "/"
            val url = connection.target.baseUrl.trimEnd('/') + route
            log.info(
                "[omnigent] JCEF live-navigate target=${connection.target.baseUrl} " +
                    "host=${connection.target.hostType} token=${Redact.redact(connection.clientOpts.token)}",
            )
            browser.loadURL(url)
            state.updateStatus(SessionStateService.ConnectionStatus.CONNECTED)
        }

        // Let actions (B4) drive deep-link navigation without an iframe reload:
        // JCEF same-origin SPA route changes are a full loadURL to the server.
        state.navigateHandler = { newRoute ->
            connection?.let {
                browser.loadURL(it.target.baseUrl.trimEnd('/') + newRoute)
            }
        }

        toolWindow.contentManager.addContent(contentFactory.createContent(panel, "", false))
    }
}

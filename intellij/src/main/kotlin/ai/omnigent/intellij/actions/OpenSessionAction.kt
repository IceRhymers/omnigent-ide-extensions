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
        log.info("[omnigent] openSession: resolving agent…")

        ApplicationManager.getApplication().executeOnPooledThread {
            val client = OmnigentApiClient(opts)

            // Sessions require an agent_id (server returns 422 otherwise). Use the
            // configured default when set, else fetch the catalog and let the user pick.
            val agentId = resolveAgentId(project, state, client) ?: return@executeOnPooledThread

            val result = client.createSession(agentId)
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
                log.info("[omnigent] openSession: session $id created (agent $agentId)")
                // Deep-link the JCEF browser to the session route (no iframe reload).
                state.navigate("/c/$id")
            }
        }
    }

    /**
     * Resolve the agent to create the session with. Returns the configured
     * default when present; otherwise fetches `GET /v1/agents` and prompts the
     * user to choose. Returns null (and surfaces an error on the EDT) when no
     * agent can be resolved — the caller should abort session creation.
     *
     * Runs on a pooled thread; the chooser dialog is dispatched to the EDT via
     * invokeAndWait so the selection can be returned synchronously.
     */
    private fun resolveAgentId(
        project: com.intellij.openapi.project.Project,
        state: SessionStateService,
        client: OmnigentApiClient,
    ): String? {
        val configured = OmnigentSettings.getInstance().defaultAgentId
        if (configured.isNotBlank()) return configured

        val agentsResp = client.listAgents()
        val agents = agentsResp.data
        if (!agentsResp.ok || agents.isNullOrEmpty()) {
            ApplicationManager.getApplication().invokeLater {
                state.updateStatus(SessionStateService.ConnectionStatus.ERROR)
                log.info("[omnigent] openSession: no agents available (${agentsResp.status}: ${agentsResp.error})")
                Messages.showErrorDialog(
                    project,
                    "No agents available to start a session (${agentsResp.status}). " +
                        "Set a default agent in Settings → Tools → Omnigent.",
                    "Omnigent",
                )
            }
            return null
        }

        if (agents.size == 1) return agents[0].id

        val names = agents.map { it.name }.toTypedArray()
        val chosenIndex = intArrayOf(-1)
        ApplicationManager.getApplication().invokeAndWait {
            chosenIndex[0] = Messages.showChooseDialog(
                project,
                "Choose an agent for the new session:",
                "Omnigent",
                null,
                names,
                names.first(),
            )
        }
        val idx = chosenIndex[0]
        if (idx < 0) {
            // User cancelled the chooser.
            ApplicationManager.getApplication().invokeLater {
                state.updateStatus(SessionStateService.ConnectionStatus.ERROR)
            }
            return null
        }
        return agents[idx].id
    }
}

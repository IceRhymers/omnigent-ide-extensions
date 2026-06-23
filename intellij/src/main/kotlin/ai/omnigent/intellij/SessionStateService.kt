package ai.omnigent.intellij

import ai.omnigent.intellij.api.ClientOptions
import ai.omnigent.intellij.config.HostType
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project

/**
 * Mutable per-project session state shared between the tool window and the
 * three actions. Holds the active session id, the resolved client options, and
 * the host type so actions can reach them without threading state through every
 * call. Mirrors vscode/src/commands/sessionState.ts (project-scoped here so
 * each open project has its own connection).
 */
@Service(Service.Level.PROJECT)
class SessionStateService {
    @Volatile var sessionId: String? = null
    @Volatile var clientOpts: ClientOptions? = null
    @Volatile var hostType: HostType = HostType.UNKNOWN

    /** Connection status for the tool-window title / status display. */
    enum class ConnectionStatus { IDLE, CONNECTING, CONNECTED, ERROR }

    @Volatile var status: ConnectionStatus = ConnectionStatus.IDLE
        private set

    /** Optional callback the tool window registers to react to navigation. */
    @Volatile var navigateHandler: ((route: String) -> Unit)? = null

    /** Optional callback the tool window registers to refresh its title. */
    @Volatile var statusListener: (() -> Unit)? = null

    fun navigate(route: String) {
        navigateHandler?.invoke(route)
    }

    fun updateStatus(newStatus: ConnectionStatus) {
        status = newStatus
        statusListener?.invoke()
    }

    companion object {
        fun getInstance(project: Project): SessionStateService =
            project.getService(SessionStateService::class.java)
    }
}

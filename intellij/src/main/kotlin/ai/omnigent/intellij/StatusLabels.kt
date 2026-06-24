package ai.omnigent.intellij

import ai.omnigent.intellij.SessionStateService.ConnectionStatus
import ai.omnigent.intellij.config.HostType

/**
 * Pure status-label helpers (B4) — connection state + host type. Used for the
 * tool-window title / status display. Mirrors the pure statusBar* helpers in
 * vscode/src/commands/openSession.ts (rendered as plain text here, not VS Code
 * `$(icon)` codicons).
 */
object StatusLabels {
    fun label(status: ConnectionStatus, hostType: HostType): String {
        val state = when (status) {
            ConnectionStatus.CONNECTED -> "Connected"
            ConnectionStatus.CONNECTING -> "Connecting…"
            ConnectionStatus.ERROR -> "Error"
            ConnectionStatus.IDLE -> "Not connected"
        }
        val host = when (hostType) {
            HostType.LOCAL -> "local"
            HostType.REMOTE -> "remote"
            HostType.UNKNOWN -> "unknown"
        }
        return "Omnigent — $state ($host)"
    }

    fun tooltip(status: ConnectionStatus, hostType: HostType, sessionId: String?): String {
        val base = label(status, hostType)
        return if (sessionId != null) "$base\nSession: $sessionId" else base
    }
}

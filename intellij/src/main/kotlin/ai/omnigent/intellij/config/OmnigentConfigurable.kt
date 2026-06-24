package ai.omnigent.intellij.config

import ai.omnigent.intellij.ConnectionResolver
import ai.omnigent.intellij.SessionStateService
import ai.omnigent.intellij.sessions.SessionsService
import com.intellij.openapi.options.BoundConfigurable
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.ui.DialogPanel
import com.intellij.ui.dsl.builder.bindText
import com.intellij.ui.dsl.builder.columns
import com.intellij.ui.dsl.builder.panel

/**
 * Settings → Tools → Omnigent (plan Phase 5). A [BoundConfigurable] using the
 * Kotlin UI DSL: `isModified`/`apply`/`reset` are wired automatically to the
 * bound [OmnigentSettings] properties, so this only declares the bindings.
 *
 * It edits the SAME persisted fields ([OmnigentSettings.serverUrl],
 * [OmnigentSettings.token], [OmnigentSettings.defaultAgentId]) — the
 * `omnigent.xml` storage schema is unchanged (additive UI only). The token is a
 * secret, so it uses a masked password field. `renderMode` is intentionally
 * absent (JCEF has no iframe/embed split — see the plan guardrails).
 *
 * On [apply] the connection is re-resolved for each open project and the
 * Sessions picker is refreshed (non-quiet) so a server-URL/token change is
 * reflected WITHOUT an IDE restart (R7 reactive concern).
 */
class OmnigentConfigurable : BoundConfigurable("Omnigent") {

    private val settings = OmnigentSettings.getInstance()

    override fun createPanel(): DialogPanel = panel {
        row("Server URL:") {
            textField()
                .bindText(settings::serverUrl)
                .columns(40)
                .comment(
                    "Manual server target. Leave blank to auto-discover a local Omnigent server.",
                )
        }
        row("Token:") {
            passwordField()
                .bindText(settings::token)
                .columns(40)
                .comment(
                    "Optional bearer token override. Prefer the CLI token in " +
                        "~/.omnigent/auth_tokens.json; this is never logged.",
                )
        }
        row("Default agent ID:") {
            textField()
                .bindText(settings::defaultAgentId)
                .columns(40)
                .comment("Default agent for new sessions. When blank, you are prompted to choose.")
        }
    }

    override fun apply() {
        super.apply()
        // Re-resolve the connection and refresh the picker for every open project
        // so a changed server URL / token takes effect without an IDE restart.
        val resolved = ConnectionResolver.resolve(settings.toSettings())
        for (project in ProjectManager.getInstance().openProjects) {
            if (project.isDisposed) continue
            val state = SessionStateService.getInstance(project)
            if (resolved != null) {
                state.clientOpts = resolved.clientOpts
                state.hostType = resolved.target.hostType
            } else {
                state.clientOpts = null
            }
            SessionsService.getInstance(project).refresh(quiet = false)
        }
    }
}

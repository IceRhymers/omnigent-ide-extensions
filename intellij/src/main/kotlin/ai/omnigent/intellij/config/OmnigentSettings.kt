package ai.omnigent.intellij.config

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

/**
 * Persisted plugin settings (server URL + optional token override). The thin
 * IDE adapter over the pure [Settings] snapshot used by [ServerTargetResolver].
 *
 * SECURITY NOTE (R3): `token` here is a manual override. The PREFERRED path is
 * the CLI token in ~/.omnigent/auth_tokens.json (auto-resolved by AuthService).
 * The token is treated as a secret and is NEVER logged — diagnostics go through
 * [ai.omnigent.intellij.Redact]. (A production hardening would move the token
 * to the IDE PasswordSafe; persisted plain here for parity with the VS Code
 * setting and to keep v1 scope minimal.)
 */
@State(
    name = "ai.omnigent.intellij.OmnigentSettings",
    storages = [Storage("omnigent.xml")],
)
@Service(Service.Level.APP)
class OmnigentSettings : PersistentStateComponent<OmnigentSettings.SettingsState> {

    data class SettingsState(
        var serverUrl: String = "",
        var token: String = "",
    )

    private var state = SettingsState()

    override fun getState(): SettingsState = state

    override fun loadState(loaded: SettingsState) {
        state = loaded
    }

    /** Convert to the pure snapshot consumed by the resolver. */
    fun toSettings(): Settings = Settings(serverUrl = state.serverUrl, token = state.token)

    var serverUrl: String
        get() = state.serverUrl
        set(value) { state.serverUrl = value }

    var token: String
        get() = state.token
        set(value) { state.token = value }

    companion object {
        fun getInstance(): OmnigentSettings =
            ApplicationManager.getApplication().getService(OmnigentSettings::class.java)
    }
}

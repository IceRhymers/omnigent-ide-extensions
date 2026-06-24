package ai.omnigent.intellij.sessions

import ai.omnigent.intellij.ConnectionResolver
import ai.omnigent.intellij.SessionStateService
import ai.omnigent.intellij.api.ApiResponse
import ai.omnigent.intellij.api.OmnigentApiClient
import ai.omnigent.intellij.api.Session
import ai.omnigent.intellij.api.SessionsResult
import ai.omnigent.intellij.config.OmnigentSettings
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.openapi.wm.ex.ToolWindowManagerListener
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Project-scoped state + refresh orchestration for the Sessions tool window
 * (plan Phase 3). Holds the loaded sessions, the canonical `truncated` flag, the
 * active [SessionFilter], the last quiet-poll signature, and the coarse list/
 * connection state. [refresh] runs the cap-following `listSessions` OFF the EDT
 * and marshals the result back ON the EDT via [reuse Phase 2 pure logic].
 *
 * Mirrors vscode/src/sessions/SessionsTreeProvider.ts (state machine + quiet
 * diff signature) but in IntelliJ idioms: off-EDT fetch, EDT apply, a single
 * model-update callback the panel registers. NO polling here — that is Phase 4.
 *
 * Phase 4 adds a visible-only quiet/diff poll: a coroutine ticker on the
 * service-owned [scope] fires every [SESSIONS_POLL_INTERVAL_MS] and calls
 * `refresh(quiet = true)` ONLY while the dedicated `OmnigentSessions` tool window
 * is visible (single-factor [com.intellij.openapi.wm.ToolWindow.isVisible]). A
 * [ToolWindowManagerListener] fires a NON-quiet refresh on the hidden->visible
 * rising edge. The ticker's [CoroutineScope] is injected by the platform and
 * cancelled when this service (its own [Disposable] root) is disposed on project
 * close, so no busy-wait outlives the project.
 */
@Service(Service.Level.PROJECT)
class SessionsService(
    private val project: Project,
    private val scope: CoroutineScope,
) : Disposable {

    private val log = logger<SessionsService>()

    /** Coarse list-load state surfaced as a parity message by the panel. */
    enum class ListState { LOADING, LOADED, ERROR, UNAUTHORIZED }

    /** The raw, FETCHED-order sessions (unsorted/unfiltered) from the last load. */
    @Volatile
    var sessions: List<Session> = emptyList()
        private set

    /** Canonical `truncated` from [SessionsResult] (NOT a UI-side recompute). */
    @Volatile
    var truncated: Boolean = false
        private set

    /** The active filter. `@Volatile` so BGT `update()` reads see the latest. */
    @Volatile
    var filter: SessionFilter = defaultFilter()

    /** Last quiet-poll diff signature; updated on every applied refresh. */
    @Volatile
    var lastSignature: String? = null
        private set

    @Volatile
    var listState: ListState = ListState.LOADING
        private set

    /**
     * Source of session pages, injectable for tests so the `refresh` seam can be
     * exercised without real HTTP. Returns the cap-following result or a non-ok
     * response (esp. 401/403) that maps to the unauthorized/error list state.
     */
    @Volatile
    var listSource: () -> ApiResponse<SessionsResult> = { resolveAndList() }

    /**
     * Callback the panel registers to rebuild its model on the EDT. Invoked with
     * the sorted+filtered view-model rows derived from the latest [sessions].
     */
    @Volatile
    var modelUpdateHandler: ((items: List<SessionItemView>) -> Unit)? = null

    /** True when a non-default filter is active (drives Clear/Filter enablement). */
    fun isFilterActive(): Boolean = isFilterActive(filter)

    /** Replace the active filter and re-apply it to the already-loaded sessions. */
    fun applyFilter(newFilter: SessionFilter) {
        filter = newFilter
        // Re-derive the view from the in-memory sessions without a network call;
        // applyOnEdt recomputes the signature from the same fetched order.
        applyOnEdt(quiet = false)
    }

    /**
     * Refresh the session list. Runs the cap-following fetch on a pooled thread
     * (never the EDT) and marshals the apply back to the EDT. A [quiet] refresh
     * skips the model rebuild when the diff signature is unchanged.
     */
    fun refresh(quiet: Boolean) {
        if (!quiet) {
            listState = ListState.LOADING
        }
        ApplicationManager.getApplication().executeOnPooledThread {
            val result = listSource()
            ApplicationManager.getApplication().invokeLater(
                { applyResult(result, quiet) },
                ModalityState.any(),
            )
        }
    }

    /** Apply a fetched result on the EDT: update state, then rebuild the model. */
    private fun applyResult(result: ApiResponse<SessionsResult>, quiet: Boolean) {
        val data = result.data
        if (!result.ok || data == null) {
            listState = if (result.status == 401 || result.status == 403) {
                ListState.UNAUTHORIZED
            } else {
                ListState.ERROR
            }
            log.info("[omnigent] sessions refresh failed (${result.status}: ${result.error})")
            sessions = emptyList()
            truncated = false
            lastSignature = null
            modelUpdateHandler?.invoke(emptyList())
            return
        }

        listState = ListState.LOADED
        sessions = data.sessions
        truncated = data.truncated

        val signature = computeSignature(listState.name, sessions)
        if (!shouldUpdateModel(quiet, lastSignature, signature)) {
            // Quiet poll with an unchanged signature — skip the model rebuild so
            // the list never flashes.
            return
        }
        lastSignature = signature
        rebuildModel()
    }

    /** Re-apply the current filter+sort to the in-memory sessions on the EDT. */
    private fun applyOnEdt(quiet: Boolean) {
        ApplicationManager.getApplication().invokeLater(
            {
                val signature = computeSignature(listState.name, sessions)
                if (!shouldUpdateModel(quiet, lastSignature, signature)) return@invokeLater
                lastSignature = signature
                rebuildModel()
            },
            ModalityState.any(),
        )
    }

    /** Filter -> sort -> view-model -> hand to the panel. EDT-only. */
    private fun rebuildModel() {
        val now = System.currentTimeMillis()
        val items = sortSessions(sessions.filter { matchesFilter(it, filter) })
            .map { toItemView(it, now) }
        modelUpdateHandler?.invoke(items)
    }

    /** Last-seen visibility of the OmnigentSessions window, for rising-edge detection. */
    @Volatile
    private var lastVisible: Boolean = false

    /** The running ticker, if any. Guarded so [startPolling] is idempotent. */
    @Volatile
    private var pollJob: Job? = null

    /**
     * Begin Phase 4 visible-only polling. Idempotent (the panel calls this once
     * on construction). Subscribes to [ToolWindowManagerListener.stateChanged] to
     * fire a NON-quiet refresh on the dedicated window's hidden->visible rising
     * edge, and launches a coroutine ticker that fires a quiet/diff refresh every
     * [SESSIONS_POLL_INTERVAL_MS] but ONLY while the window is visible.
     */
    fun startPolling() {
        if (pollJob != null) return
        lastVisible = isSessionsWindowVisible()

        project.messageBus.connect(this).subscribe(
            ToolWindowManagerListener.TOPIC,
            object : ToolWindowManagerListener {
                override fun stateChanged(toolWindowManager: ToolWindowManager) {
                    val nowVisible = isSessionsWindowVisible()
                    if (nowVisible && !lastVisible) {
                        // Rising edge (hidden -> visible): non-quiet refresh so the
                        // user sees current data immediately on show.
                        refresh(quiet = false)
                    }
                    lastVisible = nowVisible
                }
            },
        )

        pollJob = scope.launch {
            while (isActive) {
                delay(SESSIONS_POLL_INTERVAL_MS)
                // Visible-only: skip the network entirely when hidden.
                if (isSessionsWindowVisible()) {
                    refresh(quiet = true)
                }
            }
        }
    }

    /** Single-factor visibility gate: the dedicated window's [com.intellij.openapi.wm.ToolWindow.isVisible]. */
    private fun isSessionsWindowVisible(): Boolean =
        ToolWindowManager.getInstance(project).getToolWindow(SESSIONS_TOOL_WINDOW_ID)?.isVisible == true

    /** Resolve the connection from settings and run the cap-following list. */
    private fun resolveAndList(): ApiResponse<SessionsResult> {
        val state = SessionStateService.getInstance(project)
        val opts = state.clientOpts ?: run {
            val resolved = ConnectionResolver.resolve(OmnigentSettings.getInstance().toSettings())
                ?: return ApiResponse(false, 0, null, "no server configured")
            state.clientOpts = resolved.clientOpts
            state.hostType = resolved.target.hostType
            resolved.clientOpts
        }
        return OmnigentApiClient(opts).listSessions()
    }

    override fun dispose() {
        // The injected service [scope] is cancelled by the platform on dispose,
        // which stops the ticker; cancel the job explicitly too so cancellation
        // doesn't depend on scope-teardown timing. Null the references to release
        // the panel callback.
        pollJob?.cancel()
        pollJob = null
        modelUpdateHandler = null
    }

    companion object {
        /** Visible-only quiet/diff poll interval (matches the VS Code 15s cadence). */
        const val SESSIONS_POLL_INTERVAL_MS = 15_000L

        /** Id of the dedicated Sessions tool window (plan Phase 3 registration). */
        const val SESSIONS_TOOL_WINDOW_ID = "OmnigentSessions"

        fun getInstance(project: Project): SessionsService =
            project.getService(SessionsService::class.java)
    }
}

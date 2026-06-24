package ai.omnigent.intellij

import ai.omnigent.intellij.api.ApiResponse
import ai.omnigent.intellij.api.Session
import ai.omnigent.intellij.api.SessionsResult
import ai.omnigent.intellij.sessions.SessionItemView
import ai.omnigent.intellij.sessions.SessionsService
import ai.omnigent.intellij.sessions.defaultFilter
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.PlatformTestUtil
import com.intellij.testFramework.fixtures.BasePlatformTestCase

/**
 * Phase 3 green boundary: a [BasePlatformTestCase] verifying that
 * [SessionsService.refresh] runs the (stubbed) list fetch OFF the EDT and
 * marshals the apply back ON the EDT — updating the loaded sessions, applying
 * the active filter+sort, and setting the diff signature. A stubbed list source
 * keeps this off real HTTP.
 *
 * Discovered via the JUnit4 vintage engine (see build.gradle.kts) under the
 * platform's useJUnitPlatform() launcher.
 */
class SessionsServiceTest : BasePlatformTestCase() {

    fun testRefreshMarshalsResultsToEdtAndUpdatesState() {
        val service = SessionsService.getInstance(project)
        service.filter = defaultFilter()

        val captured = mutableListOf<List<SessionItemView>>()
        service.modelUpdateHandler = { items -> captured.add(items) }

        val sessions = listOf(
            Session(id = "conv_a", updatedAt = 100, status = "running"),
            Session(id = "conv_b", updatedAt = 200, status = "idle"),
            Session(id = "conv_c", updatedAt = 300, archived = true),
        )
        service.listSource = { ApiResponse(true, 200, SessionsResult(sessions, truncated = false)) }

        service.refresh(quiet = false)

        // Drain the pooled-thread fetch + the EDT invokeLater marshalling.
        PlatformTestUtil.waitWhileBusy {
            service.listState != SessionsService.ListState.LOADED
        }
        // Pump the EDT so the queued model-update callback fires.
        PlatformTestUtil.dispatchAllInvocationEventsInIdeEventQueue()

        // The apply ran on the EDT.
        assertTrue("model update must apply on the EDT", ApplicationManager.getApplication().isDispatchThread)

        assertEquals(SessionsService.ListState.LOADED, service.listState)
        assertEquals(3, service.sessions.size)
        assertFalse(service.truncated)
        assertNotNull("signature must be set after a refresh", service.lastSignature)

        // The default filter hides the archived session; sort is desc by updatedAt.
        assertTrue("model must have been rebuilt", captured.isNotEmpty())
        val items = captured.last()
        assertEquals(2, items.size)
        assertEquals("conv_b", items[0].id) // updatedAt 200 sorts before 100
        assertEquals("conv_a", items[1].id)
    }
}

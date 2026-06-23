package ai.omnigent.intellij.conformance

import ai.omnigent.intellij.auth.FileResolution
import ai.omnigent.intellij.auth.HttpAuthOutcome
import ai.omnigent.intellij.auth.HttpStatus
import ai.omnigent.intellij.auth.Lifecycle
import ai.omnigent.intellij.auth.LifecycleEvent
import ai.omnigent.intellij.auth.LifecycleState
import ai.omnigent.intellij.auth.Precedence
import ai.omnigent.intellij.auth.ResolvedToken
import ai.omnigent.intellij.auth.Tokens
import ai.omnigent.intellij.discovery.Health
import ai.omnigent.intellij.discovery.HealthObservation
import ai.omnigent.intellij.discovery.HealthOutcome
import ai.omnigent.intellij.discovery.Pidfile
import ai.omnigent.intellij.discovery.PidfileResult
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory
import org.junit.jupiter.api.assertAll
import kotlin.test.assertEquals

/**
 * AC9 cross-language conformance gate. Loads the docs/conformance JSON vectors (the same
 * vectors the TS suite runs) and asserts the Kotlin discovery/auth/config logic
 * produces the SAME expected outputs. Each vector case becomes a dynamic test.
 */
class ConformanceTest {

    private fun JsonObject.str(key: String): String? = this[key]?.jsonPrimitive?.content
    private fun JsonObject.intOrNull(key: String): Int? = this[key]?.jsonPrimitive?.content?.toIntOrNull()
    // expires_at is a Unix-seconds timestamp that can exceed Int.MAX_VALUE
    // (e.g. 4102444800 = year 2100), so it must be read as a Long — toIntOrNull
    // would silently return null and falsely fail the comparison.
    private fun JsonObject.longOrNull(key: String): Long? = this[key]?.jsonPrimitive?.content?.toLongOrNull()

    // ── pidfile.json ────────────────────────────────────────────────────────
    @TestFactory
    fun pidfile(): List<DynamicTest> {
        val vec = Vectors.load("pidfile.json")
        return vec["cases"]!!.jsonArray.map { caseEl ->
            val case = caseEl.jsonObject
            val name = case.str("name")!!
            DynamicTest.dynamicTest("pidfile/$name") {
                val input = case["input"]!!.jsonObject
                val expected = case["expected"]!!.jsonObject
                val content = input.str("content")!!
                val pidAlive = input["pidAlive"]!!.jsonPrimitive.boolean

                val result = Pidfile.parse(content, pidAlive)
                when (expected.str("status")) {
                    "ok" -> {
                        result as PidfileResult.Ok
                        assertAll(
                            { assertEquals(expected.intOrNull("pid"), result.pid) },
                            { assertEquals(expected.intOrNull("port"), result.port) },
                            { assertEquals(expected.str("baseUrl"), result.baseUrl) },
                        )
                    }
                    "dead" -> {
                        result as PidfileResult.Dead
                        assertAll(
                            { assertEquals(expected.intOrNull("pid"), result.pid) },
                            { assertEquals(expected.intOrNull("port"), result.port) },
                        )
                    }
                    "malformed" -> {
                        result as PidfileResult.Malformed
                        assertEquals(expected.str("reason"), result.reason)
                    }
                    else -> error("unknown status")
                }
            }
        }
    }

    // ── health.json ─────────────────────────────────────────────────────────
    @TestFactory
    fun health(): List<DynamicTest> {
        val vec = Vectors.load("health.json")
        return vec["cases"]!!.jsonArray.map { caseEl ->
            val case = caseEl.jsonObject
            val name = case.str("name")!!
            DynamicTest.dynamicTest("health/$name") {
                val input = case["input"]!!.jsonObject
                val expected = case["expected"]!!.jsonObject

                val status = input.intOrNull("status")
                val bodyEl = input["body"]
                val bodyStatusOk = (bodyEl as? JsonObject)?.get("status")?.jsonPrimitive?.content == "ok"
                val timedOut = input["timedOut"]?.jsonPrimitive?.booleanOrNull ?: false
                val networkError = input["networkError"]?.jsonPrimitive?.booleanOrNull ?: false

                val outcome = Health.interpret(
                    HealthObservation(
                        status = status,
                        bodyStatusOk = bodyStatusOk,
                        timedOut = timedOut,
                        networkError = networkError,
                    ),
                )
                val expectedOutcome = when (expected.str("outcome")) {
                    "ok" -> HealthOutcome.OK
                    "unhealthy" -> HealthOutcome.UNHEALTHY
                    "timeout" -> HealthOutcome.TIMEOUT
                    "unreachable" -> HealthOutcome.UNREACHABLE
                    else -> error("unknown outcome")
                }
                assertEquals(expectedOutcome, outcome)
            }
        }
    }

    // ── auth-tokens.json ──────────────────────────────────────────────────────
    @TestFactory
    fun authTokens(): List<DynamicTest> {
        val vec = Vectors.load("auth-tokens.json")
        return vec["cases"]!!.jsonArray.map { caseEl ->
            val case = caseEl.jsonObject
            val name = case.str("name")!!
            DynamicTest.dynamicTest("auth-tokens/$name") {
                val input = case["input"]!!.jsonObject
                val expected = case["expected"]!!.jsonObject
                val origin = input.str("origin")!!
                val store: Map<String, JsonObject> = input["tokens"]!!.jsonObject
                    .mapValues { (_, v) -> v.jsonObject }

                val result = Tokens.resolveTokenForOrigin(store, origin)
                when (expected.str("kind")) {
                    "bearer" -> {
                        result as FileResolution.Bearer
                        assertAll(
                            { assertEquals(expected.str("origin"), result.origin) },
                            { assertEquals(expected.str("token"), result.token) },
                            { assertEquals(expected.str("userId"), result.userId) },
                            { assertEquals(expected.longOrNull("expiresAt"), result.expiresAt) },
                        )
                    }
                    "databricks-pointer" -> {
                        result as FileResolution.DatabricksPointer
                        assertAll(
                            { assertEquals(expected.str("origin"), result.origin) },
                            { assertEquals(expected.str("workspaceHost"), result.workspaceHost) },
                        )
                    }
                    "none" -> {
                        result as FileResolution.None
                        assertEquals(expected.str("origin"), result.origin)
                    }
                    else -> error("unknown kind")
                }
            }
        }
    }

    // ── token-precedence.json ─────────────────────────────────────────────────
    @TestFactory
    fun tokenPrecedence(): List<DynamicTest> {
        val vec = Vectors.load("token-precedence.json")
        return vec["cases"]!!.jsonArray.map { caseEl ->
            val case = caseEl.jsonObject
            val name = case.str("name")!!
            DynamicTest.dynamicTest("token-precedence/$name") {
                val input = case["input"]!!.jsonObject
                val expected = case["expected"]!!.jsonObject

                val manualEl = input["manualToken"]
                val manualToken = if (manualEl == null || manualEl is kotlinx.serialization.json.JsonNull) {
                    null
                } else {
                    manualEl.jsonPrimitive.content
                }

                val fileResObj = input["fileResolution"]!!.jsonObject
                val fileResolution: FileResolution = when (fileResObj.str("kind")) {
                    "bearer" -> FileResolution.Bearer(origin = "", token = fileResObj.str("token")!!)
                    "databricks-pointer" -> FileResolution.DatabricksPointer(
                        origin = "",
                        workspaceHost = fileResObj.str("workspaceHost")!!,
                    )
                    else -> FileResolution.None(origin = "")
                }

                val resolved = Precedence.resolve(manualToken, fileResolution)
                when (expected.str("source")) {
                    "manual" -> {
                        resolved as ResolvedToken.Manual
                        assertEquals(expected.str("token"), resolved.token)
                    }
                    "file" -> {
                        resolved as ResolvedToken.File
                        assertEquals(expected.str("token"), resolved.token)
                    }
                    "databricks-pointer" -> {
                        resolved as ResolvedToken.DatabricksPointer
                        assertEquals(expected.str("workspaceHost"), resolved.workspaceHost)
                    }
                    "none" -> assertEquals(ResolvedToken.None, resolved)
                    else -> error("unknown source")
                }
            }
        }
    }

    // ── http-status.json ───────────────────────────────────────────────────────
    @TestFactory
    fun httpStatus(): List<DynamicTest> {
        val vec = Vectors.load("http-status.json")
        return vec["cases"]!!.jsonArray.map { caseEl ->
            val case = caseEl.jsonObject
            val name = case.str("name")!!
            DynamicTest.dynamicTest("http-status/$name") {
                val input = case["input"]!!.jsonObject
                val expected = case["expected"]!!.jsonObject
                val status = input["status"]!!.jsonPrimitive.int
                val outcome = HttpStatus.map(status)
                val expectedOutcome = when (expected.str("outcome")) {
                    "ok" -> HttpAuthOutcome.OK
                    "reauth" -> HttpAuthOutcome.REAUTH
                    "forbidden" -> HttpAuthOutcome.FORBIDDEN
                    "error" -> HttpAuthOutcome.ERROR
                    else -> error("unknown outcome")
                }
                assertEquals(expectedOutcome, outcome)
            }
        }
    }

    // ── auth-lifecycle.json ─────────────────────────────────────────────────────
    @TestFactory
    fun authLifecycle(): List<DynamicTest> {
        val vec = Vectors.load("auth-lifecycle.json")
        return vec["scenarios"]!!.jsonArray.map { scenarioEl ->
            val scenario = scenarioEl.jsonObject
            val name = scenario.str("name")!!
            DynamicTest.dynamicTest("auth-lifecycle/$name") {
                var state = parseState(scenario.str("initialState")!!)
                for (t in scenario["transitions"]!!.jsonArray) {
                    val transition = t.jsonObject
                    val eventObj = transition["event"]!!.jsonObject
                    val event = parseEvent(eventObj)
                    state = Lifecycle.transition(state, event)
                    assertEquals(
                        parseState(transition.str("expectedState")!!),
                        state,
                        "after event ${eventObj.str("type")}",
                    )
                }
            }
        }
    }

    private fun parseState(s: String): LifecycleState = when (s) {
        "connected" -> LifecycleState.CONNECTED
        "failed" -> LifecycleState.FAILED
        "refreshing" -> LifecycleState.REFRESHING
        "reconnecting" -> LifecycleState.RECONNECTING
        "resumed" -> LifecycleState.RESUMED
        "prompt-relogin" -> LifecycleState.PROMPT_RELOGIN
        "closed" -> LifecycleState.CLOSED
        else -> error("unknown state $s")
    }

    private fun parseEvent(obj: JsonObject): LifecycleEvent = when (obj.str("type")) {
        "auth-failure" -> LifecycleEvent.AuthFailure(obj["code"]!!.jsonPrimitive.int)
        "begin-refresh" -> LifecycleEvent.BeginRefresh
        "refresh-result" -> LifecycleEvent.RefreshResult(obj["ok"]!!.jsonPrimitive.boolean)
        "reconnect-result" -> LifecycleEvent.ReconnectResult(obj["ok"]!!.jsonPrimitive.boolean)
        "teardown" -> LifecycleEvent.Teardown
        else -> error("unknown event")
    }
}

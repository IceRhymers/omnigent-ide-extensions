package ai.omnigent.intellij

import ai.omnigent.intellij.auth.Cli
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Unit tests for the CLI login boundary (contract §6). No spawning. */
class CliTest {
    @Test
    fun omnigentLoginCommand() {
        val cmd = Cli.omnigentLoginCommand("https://omnigent.example.com")
        assertEquals("omnigent", cmd.bin)
        assertEquals(listOf("login", "https://omnigent.example.com"), cmd.args)
    }

    @Test
    fun databricksLoginCommand_withHost() {
        val cmd = Cli.databricksLoginCommand("https://dbc-x.cloud.databricks.com")
        assertEquals("databricks", cmd.bin)
        assertEquals(listOf("auth", "login", "--host", "https://dbc-x.cloud.databricks.com"), cmd.args)
    }

    @Test
    fun databricksLoginCommand_noHost() {
        assertEquals(listOf("auth", "login"), Cli.databricksLoginCommand().args)
    }

    @Test
    fun isCliAvailable_usesInjectedCheck() {
        assertTrue(Cli.isCliAvailable("omnigent") { it == "omnigent" })
        assertFalse(Cli.isCliAvailable("databricks") { it == "omnigent" })
    }
}

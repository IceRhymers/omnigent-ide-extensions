package ai.omnigent.intellij.auth

import java.io.File

/**
 * CLI login boundary (contract §6). Mirrors vscode/src/auth/cli.ts.
 *
 * Login is a documented function boundary, NOT executed in unit tests. We
 * detect CLI presence first; on absence the caller falls back to the manual
 * server-URL + token override. A CLI is never hard-required (R4).
 */
data class LoginCommand(val bin: String, val args: List<String>)

object Cli {
    /** `omnigent login <url>` for a normal omnigent server with no usable token. */
    fun omnigentLoginCommand(serverUrl: String): LoginCommand =
        LoginCommand("omnigent", listOf("login", serverUrl))

    /** `databricks auth login` when a Databricks pointer/workspace host is targeted. */
    fun databricksLoginCommand(workspaceHost: String? = null): LoginCommand {
        val args = mutableListOf("auth", "login")
        if (!workspaceHost.isNullOrEmpty()) {
            args.add("--host")
            args.add(workspaceHost)
        }
        return LoginCommand("databricks", args)
    }

    /**
     * Default presence check: resolve the binary on PATH (mirrors the TS
     * injectable check). Tests can pass their own predicate to [isCliAvailable].
     */
    fun isOnPath(bin: String): Boolean {
        val path = System.getenv("PATH") ?: return false
        val exts = if (System.getProperty("os.name").lowercase().contains("win")) {
            listOf("", ".exe", ".bat", ".cmd")
        } else {
            listOf("")
        }
        return path.split(File.pathSeparatorChar).any { dir ->
            exts.any { ext -> File(dir, bin + ext).canExecute() }
        }
    }

    /** Injectable presence check so callers (and tests) don't shell out. */
    fun isCliAvailable(bin: String, check: (String) -> Boolean = ::isOnPath): Boolean =
        check(bin)
}

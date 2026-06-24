package ai.omnigent.intellij.discovery

/**
 * Runtime PID liveness probe (contract §1 "Liveness / staleness").
 * Mirrors vscode/src/discovery/liveness.ts (which uses `process.kill(pid, 0)`).
 *
 * The JVM has no signal-0 primitive, so on POSIX we shell out to `kill -0 <pid>`
 * which exits 0 when the process exists (even if we lack permission to signal
 * it on some platforms) and non-zero (ESRCH) when it does not. Kept separate
 * from the pure parser so the parser stays testable. The /health probe (§2) is
 * the authoritative confirmation that the right server is reachable.
 */
object Liveness {
    fun isPidAlive(pid: Int): Boolean {
        if (pid <= 0) return false
        val os = System.getProperty("os.name").lowercase()
        return try {
            if (os.contains("win")) {
                // tasklist filters by PID; a present PID prints a row, otherwise
                // "INFO: No tasks ...". Grep the PID out of stdout.
                val proc = ProcessBuilder("tasklist", "/FI", "PID eq $pid", "/NH")
                    .redirectErrorStream(true)
                    .start()
                val out = proc.inputStream.bufferedReader().readText()
                proc.waitFor()
                out.contains(pid.toString())
            } else {
                // POSIX: `kill -0` mirrors signal-0 probe semantics.
                val proc = ProcessBuilder("kill", "-0", pid.toString())
                    .redirectErrorStream(true)
                    .start()
                proc.waitFor() == 0
            }
        } catch (_: Exception) {
            false
        }
    }
}

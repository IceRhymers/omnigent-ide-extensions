package ai.omnigent.intellij.discovery

/**
 * Pure pidfile parsing (contract §1). Mirrors vscode/src/discovery/pidfile.ts.
 *
 * Format: two lines — line 1 = PID (positive integer), line 2 = port (1..65535).
 * `pidAlive` is supplied as an external observation so this stays pure and
 * testable without spawning processes (see [Liveness] for the runtime probe).
 * Conformance: docs/conformance/pidfile.json.
 */
sealed interface PidfileResult {
    data class Ok(val pid: Int, val port: Int, val baseUrl: String) : PidfileResult
    data class Dead(val pid: Int, val port: Int) : PidfileResult
    data class Malformed(val reason: String) : PidfileResult
}

object Pidfile {
    private const val MIN_PORT = 1
    private const val MAX_PORT = 65535
    private val INT_RE = Regex("^-?\\d+$")

    /** Parse raw pidfile content given an external liveness observation. */
    fun parse(content: String, pidAlive: Boolean): PidfileResult {
        val lines = content
            .split("\n")
            .map { it.trim() }
            .filter { it.isNotEmpty() }

        if (lines.size < 2) {
            return PidfileResult.Malformed("expected two lines (pid then port)")
        }

        val pidRaw = lines[0]
        val portRaw = lines[1]

        if (!INT_RE.matches(pidRaw)) {
            return PidfileResult.Malformed("pid is not an integer")
        }
        // Parse as Long first to avoid overflow misclassifying a huge value.
        val pidLong = pidRaw.toLong()
        if (pidLong <= 0) {
            return PidfileResult.Malformed("pid is not a positive integer")
        }

        if (!INT_RE.matches(portRaw)) {
            return PidfileResult.Malformed("port is not an integer")
        }
        val portLong = portRaw.toLong()
        if (portLong < MIN_PORT || portLong > MAX_PORT) {
            return PidfileResult.Malformed("port out of range")
        }

        val pid = pidLong.toInt()
        val port = portLong.toInt()

        if (!pidAlive) {
            return PidfileResult.Dead(pid, port)
        }

        return PidfileResult.Ok(pid, port, "http://127.0.0.1:$port")
    }
}

package ai.omnigent.intellij.conformance

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import java.io.File

/**
 * Loads the language-neutral conformance vectors from docs/conformance/ (the
 * single source of truth SHARED with the TS suite — AC9). The Kotlin suite
 * loads these IDENTICALLY to the TS suite and must produce the same outputs.
 *
 * The conformance dir is located by walking up from the test working directory
 * until `docs/conformance` is found — works whether Gradle runs from the
 * intellij/ module dir or the repo root. Mirrors vscode/src/test/vectors.ts.
 */
object Vectors {
    val json = Json { ignoreUnknownKeys = true }

    val conformanceDir: File by lazy { findConformanceDir() }

    private fun findConformanceDir(): File {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        var i = 0
        while (dir != null && i < 8) {
            val candidate = File(dir, "docs/conformance")
            if (candidate.isDirectory) return candidate
            dir = dir.parentFile
            i++
        }
        error("could not locate docs/conformance from ${System.getProperty("user.dir")}")
    }

    fun load(name: String): JsonObject {
        val file = File(conformanceDir, name)
        return json.parseToJsonElement(file.readText()).let { it as JsonObject }
    }
}

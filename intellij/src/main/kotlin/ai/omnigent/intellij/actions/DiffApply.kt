package ai.omnigent.intellij.actions

import ai.omnigent.intellij.api.DiffResult
import ai.omnigent.intellij.config.HostType

/**
 * Pure diff-apply logic (B4) — gating, snapshot-before-write, and partial-apply
 * rollback. Mirrors the pure half of vscode/src/commands/diffs.ts.
 *
 * Rules from the plan (resolved v2):
 *  - BOTH local AND remote sessions can VIEW diffs (server proxies to the runner).
 *  - APPLY (write after-content to workspace) is ONLY enabled when hostType == LOCAL.
 *  - SNAPSHOT each target file BEFORE writing so revert is truthful.
 *  - PARTIAL-APPLY rollback: on failure mid-batch, report which files were applied
 *    and offer revert of the applied subset from the snapshots.
 *
 * Read/write IO is injected so this is testable without real files; the
 * IntelliJ DiffManager/VFS wiring lives in the action classes.
 */
data class ApplyResult(
    val applied: List<String>,
    val failed: List<String>,
    val snapshots: Map<String, String>,
)

object DiffApply {
    /** Pure: is apply allowed for this host type? */
    fun isApplyAllowed(hostType: HostType): Boolean = hostType == HostType.LOCAL

    /** Pure: build (relativePath, afterContent) pairs to apply. */
    fun buildApplyPlan(diffs: List<DiffResult>): List<Pair<String, String>> =
        diffs.map { it.relativePath to it.after }

    /**
     * Execute an apply plan with snapshot-before-write and partial-apply
     * rollback. Read/write functions are injected so this stays pure/testable.
     * [readFile] should return the prior content or throw if the file is absent.
     */
    fun executeApplyPlan(
        plan: List<Pair<String, String>>,
        workspaceRoot: String,
        readFile: (absPath: String) -> String,
        writeFile: (absPath: String, content: String) -> Unit,
    ): ApplyResult {
        val root = workspaceRoot.trimEnd('/')
        val snapshots = LinkedHashMap<String, String>()
        val applied = mutableListOf<String>()
        val failed = mutableListOf<String>()

        // Phase 1: snapshot all targets before touching any of them.
        for ((relPath, _) in plan) {
            val absPath = "$root/$relPath"
            val prior = try {
                readFile(absPath)
            } catch (_: Exception) {
                "" // new file — snapshot is empty string
            }
            snapshots[relPath] = prior
        }

        // Phase 2: apply each file; stop on first failure (state is in `applied`).
        for ((relPath, after) in plan) {
            val absPath = "$root/$relPath"
            try {
                writeFile(absPath, after)
                applied.add(relPath)
            } catch (_: Exception) {
                failed.add(relPath)
                break
            }
        }

        return ApplyResult(applied, failed, snapshots)
    }

    /**
     * Revert applied files from snapshots (partial-apply rollback).
     * Returns paths that could not be reverted.
     */
    fun revertFromSnapshots(
        toRevert: List<String>,
        snapshots: Map<String, String>,
        workspaceRoot: String,
        writeFile: (absPath: String, content: String) -> Unit,
    ): List<String> {
        val root = workspaceRoot.trimEnd('/')
        val failedRevert = mutableListOf<String>()
        for (relPath in toRevert) {
            val prior = snapshots[relPath] ?: continue
            val absPath = "$root/$relPath"
            try {
                writeFile(absPath, prior)
            } catch (_: Exception) {
                failedRevert.add(relPath)
            }
        }
        return failedRevert
    }
}

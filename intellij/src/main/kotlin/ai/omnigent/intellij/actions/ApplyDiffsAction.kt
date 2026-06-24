package ai.omnigent.intellij.actions

import ai.omnigent.intellij.SessionStateService
import ai.omnigent.intellij.api.DiffResult
import ai.omnigent.intellij.api.OmnigentApiClient
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.guessProjectDir
import com.intellij.openapi.ui.Messages
import java.io.File
import java.nio.charset.StandardCharsets

/**
 * B4 — Apply changed files (LOCAL sessions ONLY).
 *
 * Gated by [DiffApply.isApplyAllowed] (hostType == LOCAL — no documented remote
 * write-back endpoint). Snapshots each target file BEFORE writing so revert is
 * truthful, applies atomically per file, and on a mid-batch failure offers
 * partial-apply rollback from the snapshots. Pure gating/snapshot/rollback
 * logic lives in [DiffApply]; this action wires the IDE prompts + file IO.
 * Mirrors the apply half of vscode/src/commands/diffs.ts.
 */
class ApplyDiffsAction : AnAction() {

    private val log = logger<ApplyDiffsAction>()

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val state = SessionStateService.getInstance(project)

        if (!DiffApply.isApplyAllowed(state.hostType)) {
            Messages.showWarningDialog(
                project,
                "Apply is only available for local sessions (current session host type is ${state.hostType.name.lowercase()}).",
                "Omnigent",
            )
            return
        }

        val opts = state.clientOpts
        val sessionId = state.sessionId
        if (opts == null || sessionId == null) {
            Messages.showWarningDialog(project, "No active session.", "Omnigent")
            return
        }
        val workspaceRoot = project.guessProjectDir()?.path
        if (workspaceRoot == null) {
            Messages.showWarningDialog(project, "No project directory open.", "Omnigent")
            return
        }

        ApplicationManager.getApplication().executeOnPooledThread {
            val client = OmnigentApiClient(opts)
            val filesResult = client.listChangedFiles(sessionId)
            val files = filesResult.data
            if (!filesResult.ok || files.isNullOrEmpty()) {
                ApplicationManager.getApplication().invokeLater {
                    Messages.showInfoMessage(project, "No changed files to apply.", "Omnigent")
                }
                return@executeOnPooledThread
            }

            val diffs = mutableListOf<DiffResult>()
            for (file in files) {
                val envId = file.environmentId ?: "default"
                val dr = client.fetchDiff(sessionId, envId, file.relativePath)
                if (dr.ok && dr.data != null) diffs.add(dr.data)
            }

            val plan = DiffApply.buildApplyPlan(diffs)
            log.info("[omnigent] applying ${plan.size} file(s)")

            ApplicationManager.getApplication().invokeLater {
                WriteCommandAction.runWriteCommandAction(project) {
                    val result = DiffApply.executeApplyPlan(
                        plan,
                        workspaceRoot,
                        readFile = { abs -> File(abs).readText(StandardCharsets.UTF_8) },
                        writeFile = { abs, content ->
                            val f = File(abs)
                            f.parentFile?.mkdirs()
                            f.writeText(content, StandardCharsets.UTF_8)
                        },
                    )

                    if (result.failed.isEmpty()) {
                        Messages.showInfoMessage(project, "Applied ${result.applied.size} file(s).", "Omnigent")
                        log.info("[omnigent] apply complete: ${result.applied.joinToString(", ")}")
                    } else {
                        val choice = Messages.showYesNoDialog(
                            project,
                            "Applied ${result.applied.size} file(s), failed ${result.failed.size}. Revert the applied files?",
                            "Omnigent — Partial Apply",
                            "Revert Applied",
                            "Keep",
                            Messages.getWarningIcon(),
                        )
                        if (choice == Messages.YES) {
                            val failedRevert = DiffApply.revertFromSnapshots(
                                result.applied,
                                result.snapshots,
                                workspaceRoot,
                                writeFile = { abs, content -> File(abs).writeText(content, StandardCharsets.UTF_8) },
                            )
                            if (failedRevert.isEmpty()) {
                                Messages.showInfoMessage(project, "Reverted all applied files.", "Omnigent")
                            } else {
                                Messages.showErrorDialog(
                                    project,
                                    "Revert partial failure — could not revert: ${failedRevert.joinToString(", ")}",
                                    "Omnigent",
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

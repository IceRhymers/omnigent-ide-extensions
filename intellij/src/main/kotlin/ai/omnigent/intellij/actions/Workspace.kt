package ai.omnigent.intellij.actions

/**
 * Pure workspace-path helpers for the send-selection action (B4).
 * Mirrors the pure functions in vscode/src/commands/sendSelection.ts.
 */
data class SelectionPayload(
    val content: String,
    val relativePath: String? = null,
)

object Workspace {
    /** Pure: compute a workspace-relative path from an absolute path + root. */
    fun workspaceRelativePath(absolutePath: String, workspaceRoot: String): String {
        val root = workspaceRoot.trimEnd('/')
        return if (absolutePath.startsWith("$root/")) {
            absolutePath.substring(root.length + 1)
        } else {
            absolutePath // fallback: outside workspace
        }
    }

    /**
     * Pure: compute the content + relative path from editor state. Takes plain
     * data (not IDE objects) so it is unit-testable.
     */
    fun computeSelectionPayload(
        selectedText: String,
        absoluteFilePath: String?,
        workspaceRoot: String?,
    ): SelectionPayload {
        val content = selectedText.trim().ifEmpty { "(no selection)" }
        if (absoluteFilePath == null) return SelectionPayload(content)
        val relativePath = if (workspaceRoot != null) {
            workspaceRelativePath(absoluteFilePath, workspaceRoot)
        } else {
            absoluteFilePath
        }
        return SelectionPayload(content, relativePath)
    }
}

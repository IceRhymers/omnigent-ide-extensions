# Changelog

All notable changes to the unofficial Omnigent VS Code extension are documented here.

## [0.2.0]

First release of the unofficial community build, published from
[IceRhymers/omnigent-ide-extensions](https://github.com/IceRhymers/omnigent-ide-extensions).
It's built from the upstream extension source at `custom/integration` @ `2c1a8e20a`
(see `PROVENANCE.md` in the repository).

### Remote servers

- Open remote `https://` Omnigent servers through a loopback credential proxy on
  `127.0.0.1`. It forwards HTTP, streams and WebSockets with your session as
  `Authorization: Bearer`, keeps cookies and tokens out of the webview, and answers
  only under a random per-launch path for its own `Host` and `Origin`.
- Sign in with single sign-on (**Sign in with browser**) or the server's own
  username-and-password page. An existing `omnigent login` CLI session is reused,
  read-only. Sessions are kept in VS Code's secret storage and renewed before they
  expire.
- New **Omnigent: Connect to Server…** (this computer, a recent server or a URL) and
  **Omnigent: Sign Out of Server** commands. The panel shows actionable messages instead
  of waiting forever when no server is available.
- **Databricks Apps** (`https://<app>.databricksapps.com`): sign in with the Databricks
  CLI's sign-in for the app's workspace, or **Sign in with Databricks** in your browser.
- **Databricks workspaces** (`https://<workspace>/omnigent`): the extension bundles its
  own build of the Omnigent web app and sends only the Omnigent API to the workspace.

### Run Omnigent from VS Code

- **Omnigent: Start on This Computer** starts a local server with this computer as its
  host and opens it in the panel.
- **Omnigent: Use This Computer as a Host** connects this computer to the remote server
  the panel shows, signing in with the CLI first when needed.
- **Omnigent: Set Up Unity Gateway…** runs `omnigent setup`, so the coding agents on
  this computer can reach their models through a Databricks workspace's Unity Gateway.
- When the `omnigent` CLI is missing, the extension offers its install command.

### Sessions and worktrees

- Add an activity-bar Sessions view with **This Folder** (including git worktrees) and
  **All Sessions** scopes, session status, harness labels, and automatic refresh.
- Open a session from the tree in the editor-beside panel.
- Create a session in the current workspace folder with a chosen coding agent, with
  last-used ordering and per-host availability.
- Group sessions by git worktree when the repository has several, with waiting/running
  counts per worktree and the current window's worktree first.
- **Omnigent: Switch Worktree…** and worktree row actions to open a worktree in a new or
  the current window (keeping the opened subfolder), open a terminal there, copy its
  path, or reveal it in the OS file manager. New `omnigent.worktrees.openIn` setting.
- **New Session in New Worktree…** asks the host to create a worktree (branch and base
  of your choice) with the session; a worktree row's **+** creates a session there.
- **Go to Worktree** on a session in another worktree opens that worktree's window with
  the session in the pane. The extension now activates on startup to receive the
  handoff, and consumes it when the window gains focus.

## [0.1.0]

Initial release by the Omnigent project — a minimal, iframe-only client for a locally
running Omnigent server.

- Open a running local Omnigent server in an editor-beside panel.
- **Omnigent: Open** command, available from the editor-title bar and the
  command palette, plus an activity-bar view with an "Open Omnigent" button.
- Automatically discovers a local server via `~/.omnigent/local_server.pid`, or
  point the extension at one with the `omnigent.serverUrl` setting. Localhost
  servers only in this build.

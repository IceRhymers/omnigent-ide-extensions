# Omnigent IDE Extensions (Unofficial)

Unofficial, community-maintained IDE clients for [Omnigent](https://github.com/omnigent-ai/omnigent).
They're not made, reviewed or supported by the Omnigent team or Databricks; report
problems in this repository's [issues](https://github.com/IceRhymers/omnigent-ide-extensions/issues).

| Directory | What | Status |
|---|---|---|
| [`vscode/`](vscode/) | VS Code extension: Sessions view, editor-beside Omnigent pane, local and remote servers (including Databricks Apps and workspaces), worktrees | Preview, released to the VS Code Marketplace and Open VSX; see [`vscode/README.md`](vscode/README.md) |
| [`intellij/`](intellij/) | IntelliJ / PyCharm plugin (JCEF tool window) | Prototype; see [`intellij/README.md`](intellij/README.md) |
| [`docs/`](docs/) | Discovery/auth contract and language-neutral conformance vectors | |
| `third_party/omnigent` | Omnigent submodule: source of the web app the VS Code extension bundles for Databricks workspaces | |

The VS Code extension comes from the Omnigent project's own extension source; see
[`vscode/PROVENANCE.md`](vscode/PROVENANCE.md). Both extensions are thin clients of an
Omnigent server's existing HTTP API and need no server changes.

## Development

Needs Node 22+ and pnpm for `vscode/`, and JDK 17 for `intellij/`.

```bash
make help            # every target
make install check   # VS Code: install, format check, type-check, tests, bundle
make submodule web-deps package-vscode   # full .vsix, with the bundled web app
make test-intellij   # IntelliJ: unit + conformance tests
```

Releases of the VS Code extension: [`vscode/PUBLISHING.md`](vscode/PUBLISHING.md).

Licensed under Apache-2.0 ([`LICENSE`](LICENSE)).

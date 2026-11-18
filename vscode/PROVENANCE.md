# Provenance

This extension is the Omnigent project's VS Code extension, maintained here as an
unofficial build because upstream doesn't take changes to it. This repository is now
its source of truth.

## Source

| | |
|---|---|
| Upstream project | [omnigent-ai/omnigent](https://github.com/omnigent-ai/omnigent), `editors/vscode/` (Apache-2.0) |
| Imported from | fork [IceRhymers/omnigent](https://github.com/IceRhymers/omnigent), branch `custom/integration` |
| Import commit | `2c1a8e20a0baa4a1851ada87d6d75b5c0e1cc891` |
| Its upstream base | `06b548c24c5be3d3074fa7a64f8749a554ddef71` (omnigent-ai/omnigent `main`, 2026-11-09) |

`custom/integration` is the upstream base plus these pull requests on the fork, all
limited to `editors/vscode/`:

| PR | Branch | Change |
|---|---|---|
| #1 | `custom/vs-code-remote-ug` | Connect to remote servers through a local credential proxy |
| #2 | `custom/vs-code-databricks-apps` | Open Omnigent Databricks Apps through the proxy |
| #3 | `custom/vs-code-databricks-workspace` | Open Databricks workspace-hosted Omnigent through the proxy |
| #4 | `custom/vs-code-local-host` | Start Omnigent and host on servers from VS Code |
| #5 | `custom/vs-code-sessions` | Sessions sidebar and creating sessions in this folder |
| #7 | `custom/vscode-worktrees` | Group sessions by worktree, worktree navigation and sessions in new worktrees |

The tree was copied with
`git archive 2c1a8e20a editors/vscode | tar -x --strip-components=1`, replacing this
repository's earlier `vscode/` (a different, iframe/embed prototype).

## Vendored files

`src/vendor/omnigent/` holds the two desktop-app helpers the extension imported from
the monorepo (`../../../../web/electron/src/`), copied unchanged from the import commit:

| File | Upstream path |
|---|---|
| `url.js`, `url.d.ts` | `web/electron/src/url.js`, `url.d.ts` |
| `loopback-oauth.js`, `loopback-oauth.d.ts` | `web/electron/src/loopback-oauth.js`, `loopback-oauth.d.ts` |

The `.js` files are identical at the upstream base. The `.d.ts` files exist only on the
fork branch. `make vendor-check` compares the `.js` files with the submodule's copies.

## Submodule

`third_party/omnigent` pins omnigent-ai/omnigent at the upstream base
(`06b548c24`), the commit the extension was built and tested against. It's the source
of the web app bundled as `dist/web-ui` for Databricks workspaces
(`scripts/build-web-ui.js`) and the reference for the vendored files.

## Changes from upstream

Relative to `editors/vscode/` at the import commit:

- `package.json`: name, publisher placeholder, display name, description, version,
  `preview`, repository/bugs/homepage, categories and keywords; scripts
  (`vscode:prepublish`, `format`, `format:check`, `check:publisher`, `package`);
  devDependencies outside the monorepo's pnpm catalog (`vitest` pinned, `ovsx` and
  `prettier` added, `@vscode/vsce` 4, `@types/vscode` pinned to the 1.74 engine);
  `packageManager`.
- `pnpm-lock.yaml`, `pnpm-workspace.yaml`: the extension is its own pnpm project here.
- `scripts/build-web-ui.js`: builds `third_party/omnigent/web` and writes
  `dist/web-ui-licenses.md`. `scripts/check-publisher.js` is new.
- `src/auth/cliTokens.ts`, `src/auth/databricksSignIn.ts`, `src/auth/omnigentSignIn.ts`,
  `src/servers/classify.ts`: import the vendored helpers.
- `src/servers/connection.ts`: the "packaged without the Omnigent app" message names
  `make build-web-ui`.
- `src/discovery/health.ts`, `src/sessions/api.test.ts`: Prettier formatting only.
- `src/discovery/conformance.test.ts`, `src/test/vectors.ts`: new; run the shared
  `docs/conformance/` vectors the IntelliJ plugin also runs.
- `README.md`, `CHANGELOG.md`, `PUBLISHING.md`, `.vscodeignore`: rewritten for this
  repository. `NOTICE`, `PROVENANCE.md`, `.prettierrc.json` (upstream `web/`'s) and
  `.prettierignore` are new. `justfile` was replaced by the root `Makefile`.

## Bringing in upstream changes

For extension changes made upstream (or on the fork) after the import commit:

```bash
# in a checkout of omnigent-ai/omnigent (or the fork)
git format-patch 2c1a8e20a..<ref> -o /tmp/vscode-patches -- editors/vscode

# here, on a branch
git am -p3 --directory=vscode /tmp/vscode-patches/*.patch
```

`-p3` strips `a/editors/vscode/` and `--directory=vscode` re-roots the paths. Patches
touching files changed here (see above) may need a manual merge.

For the web app and the vendored helpers:

1. Move the submodule: `git -C third_party/omnigent fetch --depth 1 origin <sha>` and
   `git -C third_party/omnigent checkout <sha>`, then stage `third_party/omnigent`.
2. If `make vendor-check` fails, copy the new `url.js` / `loopback-oauth.js` (and any
   new exports into the `.d.ts` files), then run `make check`.
3. Rebuild with `make web-deps package-vscode` and check a Databricks workspace.
4. Update the tables above.

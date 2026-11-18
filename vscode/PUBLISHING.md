# Publishing the extension

The extension is published by GitHub Actions
([`.github/workflows/vscode-release.yml`](../.github/workflows/vscode-release.yml)) to
the **VS Code Marketplace** and **Open VSX** (Cursor, Windsurf, VSCodium). No store
token is kept for the Marketplace: the workflow signs in with GitHub OIDC (Trusted
Publishing). Open VSX needs a token for the first release only.

Until the store accounts exist, `package.json` uses the publisher
`publisher-id-placeholder`. `pnpm run check:publisher` (the release workflow's first
check) fails while it's anywhere under `vscode/`, so nothing can be published under it.

## One-time setup

Do this from a computer that can reach both stores.

### 1. Pick the publisher ID

One ID for both stores, for example `icerhymers`. It becomes part of the extension ID
(`<id>.omnigent-vscode`) and its store URLs, and **can't be changed later**.

- Lowercase letters, digits and hyphens only (vsce rejects underscores). Open VSX
  compares the namespace with `publisher` case-sensitively.
- Nothing that looks official (`omnigent`, `databricks`, …): both stores refuse
  look-alike names, and it would mislead users about who publishes this.

### 2. VS Code Marketplace publisher

1. Sign in at <https://marketplace.visualstudio.com/manage> with a Microsoft account.
2. **Create publisher**: **ID** is the ID from step 1. **Name** is the display name
   shown on the listing (must be unique), e.g. your name.

No Azure DevOps organization or personal access token is needed. Azure DevOps global
PATs are being retired, which is why the workflow uses Trusted Publishing.

### 3. Open VSX namespace

1. Create an Eclipse account at <https://accounts.eclipse.org/user/register>. Fill in
   **GitHub Username** (`IceRhymers`).
2. Sign in at <https://open-vsx.org> with GitHub. Under **Settings → Profile**, choose
   **Log in with Eclipse**, then **Show Publisher Agreement → Agree**.
3. **Settings → Access Tokens → Generate New Token**. Copy it; you need it twice below.
4. Create the namespace:

   ```bash
   npx ovsx create-namespace <id> -p <token>
   ```

5. Claim ownership of the namespace by opening an issue at
   <https://github.com/EclipseFdn/open-vsx.org/issues/new/choose>. Approval can take a
   few days. Until then the listing shows an "unverified" warning, and you can't set up
   Trusted Publishing for Open VSX (step 8).

### 4. Replace the placeholder

On a branch:

```bash
cd vscode
perl -pi -e 's/publisher-id-placeholder/<id>/g' \
  $(grep -rl publisher-id-placeholder . --exclude-dir=node_modules --exclude-dir=dist \
    --exclude='*.vsix' --exclude=PUBLISHING.md --exclude=check-publisher.js)
pnpm run check:publisher   # prints "publisher: <id>"
```

That updates `package.json` and the install links in `README.md`. Open a PR and merge
it to `master`.

If you installed a local test build before, uninstall it
(`code --uninstall-extension publisher-id-placeholder.omnigent-vscode`) before
installing from a store; the two IDs would otherwise both be active and conflict.

### 5. GitHub environment

In the repository: **Settings → Environments → New environment** named `marketplace`.

- **Required reviewers:** add yourself, and leave **Prevent self-review** off. Every
  publish then waits for your approval.
- **Deployment branches and tags:** **Selected branches and tags**, add `master`.
- **Environment secrets:** add `OVSX_PAT` with the Open VSX token from step 3.

### 6. Marketplace Trusted Publishing

At <https://marketplace.visualstudio.com/manage>, open your publisher, then
**Trusted Publishing → Create**, and enter:

| Field | Value |
|---|---|
| Owner | `IceRhymers` |
| Repository | `omnigent-ide-extensions` |
| Workflow | `vscode-release.yml` |
| Environment | `marketplace` |

The workflow file name and the environment name are part of this registration (and of
Open VSX's in step 8). Renaming either breaks publishing until both are updated.

### 7. First release

1. **Actions → VS Code Extension Release → Run workflow** on `master`, version `0.2.0`,
   `dry_run` checked. It runs the checks and builds the `.vsix`; download it from the
   run's `vsix` artifact and try it (**Extensions: Install from VSIX…**).
2. Run it again with `dry_run` unchecked, and approve the `marketplace` deployment when
   asked. It publishes the same `.vsix` to the Marketplace (Trusted Publishing) and
   Open VSX (`OVSX_PAT`), then creates the `vscode-v0.2.0` GitHub release with the
   `.vsix` and its `.sha256`.
3. The Marketplace scans a new version before listing it; that takes a few minutes.

If the Marketplace step fails on the first release (for example, Trusted Publishing
won't accept a publisher with no extensions yet), upload the dry run's `.vsix` by hand
on the publisher's manage page (**New extension → Visual Studio Code**), then re-run
the failed jobs. Both publish steps use `--skip-duplicate`, so a version that's
already up is skipped.

If the Marketplace rejects the display name `Omnigent (Unofficial)` (display names must
be unique, and look-alikes of existing products can be refused), change `displayName`
in `package.json` and release again.

### 8. After the first release: drop the Open VSX token

Open VSX only allows Trusted Publishing for an extension that already has a version
published, from a namespace you own. Once the claim from step 3 is granted:

1. Register a trusted publisher for `<id>/omnigent-vscode` on open-vsx.org with the
   same owner, repository, workflow and environment as step 6 (see
   [Trusted Publishing](https://github.com/eclipse-openvsx/openvsx/wiki/Trusted-Publishing)).
2. Delete the `OVSX_PAT` secret from the `marketplace` environment, and delete the
   token on open-vsx.org.

No workflow change is needed: with no `OVSX_PAT`, `ovsx publish` exchanges the job's
OIDC token instead.

## Every release

1. In a PR: bump `version` in `vscode/package.json` and add a `## [X.Y.Z]` section to
   `vscode/CHANGELOG.md` (the workflow uses it as the release notes). Merge to `master`.
2. Run **VS Code Extension Release** with that version: first with `dry_run`, then
   without, and approve the deployment.

The workflow refuses to release when the version doesn't match `package.json`, when the
`vscode-v<version>` tag already exists, or from a branch other than `master`. It
re-runs every check (`make check`, `make vendor-check`) before packaging, and publishes
the exact file it checksummed.

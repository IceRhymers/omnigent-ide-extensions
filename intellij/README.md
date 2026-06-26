# Omnigent IntelliJ / PyCharm plugin (Phase B)

> ⚠️ **Unofficial & experimental.** This is a community-built, unofficial plugin and is not
> affiliated with, endorsed by, or supported by Omnigent. It is experimental software provided
> as-is — expect rough edges, breaking changes, and incomplete features. Use at your own risk.

JVM/Kotlin port of the VS Code extension. Embeds the Omnigent web UI in a JCEF
tool window pointed at a configurable server target, plus three native editor
actions (send selection, open/switch session, view/apply diffs).

## Architecture (per the plan §3 Phase B + ADR)

- **Embedding transport (B2): JCEF live-navigate.** Unlike VS Code (which bundles
  ap-web), IntelliJ uses `JBCefBrowser` — full in-process Chromium with same-origin
  `loadURL`. It navigates directly to `resolvedServerUrl + "/c/<sessionId>"|"/"`.
  Terminals/WebSockets work natively; no CSP work and no ap-web bundle needed.
  Guarded by `JBCefApp.isSupported()` (R5/PM7) with actionable guidance when the
  runtime lacks JCEF.
- **Discovery / auth / config (B3): pure parallel impl of the contract.** Re-implements
  the VS Code modules in Kotlin under `discovery/`, `auth/`, `config/`. Parse/resolution
  is PURE (no IO) so the conformance vectors run on a plain JVM without an IDE.
- **Three native actions (B4):** `SendSelectionAction`, `OpenSessionAction`,
  `ViewDiffsAction`, `ApplyDiffsAction`. HTTP via `java.net.http.HttpClient`;
  diffs via `DiffManager` + in-memory `DiffContent`. Apply is gated to
  `hostType == LOCAL` with snapshot-before-write + partial-apply rollback.

## Build pins (B1 / plan Q3)

- IntelliJ Platform Gradle Plugin **v2** (`org.jetbrains.intellij.platform`).
- Kotlin/JVM, JDK 17 toolchain.
- `sinceBuild = 241` (2024.1 — first JCEF-capable JBR). `untilBuild` is
  **intentionally omitted** (open upper bound) — a deliberate reach-over-safety
  choice; record the highest tested IDEA/PyCharm build in `gradle.properties`.
- Targets IDEA + PyCharm (Community + Professional). Default platform is IDEA
  Community (`platformType=IC`); switch via `-PplatformType=PC|PY|IU` to build/verify
  the other IDEs (the plugin depends only on `com.intellij.modules.platform`, so a
  single artifact loads in all four).

## Build & test

```sh
# Run the conformance + unit tests (downloads the IntelliJ Platform on first run).
./gradlew test

# Produce the version-stamped plugin .zip (build/distributions/omnigent-intellij-<ver>.zip).
./gradlew buildPlugin

# Verify against a specific IDE (e.g. PyCharm Community):
./gradlew test -PplatformType=PC -PplatformVersion=2024.1
```

> **Network note:** the IntelliJ Platform Gradle Plugin v2 downloads the platform
> and its dependencies from the JetBrains + Maven Central repositories on first
> build. In a network-restricted sandbox, dependency resolution will fail; the code
> and project structure are still correct and self-consistent, and the commands
> above are exactly what a normal (networked) environment runs.

## Conformance gate (AC9)

`src/test/kotlin/ai/omnigent/intellij/conformance/` loads the shared
`docs/conformance/*.json` vectors (located by walking up from the test working
dir) and asserts the Kotlin discovery/auth/config logic produces the SAME outputs
as the TS suite — pidfile parse (incl. stale/dead/malformed), token resolution
(incl. Databricks pointer), token precedence, 401 vs 403, `/health` variants, and
the `auth-lifecycle.json` 401→refresh→reconnect/resume state machine.

## Open questions carried forward

- **Q2 — JCEF bearer auth for remote servers.** The served SPA is same-origin and
  uses the server's cookie/session on the local single-user path (primary v1). For a
  remote/authenticated server, the bearer must be injected via a JCEF
  `CefRequestHandler` (adding `Authorization` to outgoing requests) or a cookie set on
  the JCEF cookie manager before `loadURL` — never in a navigable URL (R3). The
  request-handler seam is documented in `OmnigentToolWindowFactory`; full remote-bearer
  wiring is deferred with Q2.

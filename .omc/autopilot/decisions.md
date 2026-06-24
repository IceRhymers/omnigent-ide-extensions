# Autopilot execution decisions

## ap-web bundle sourcing (resolves plan §A6 / C2 / open question)
**Decision (user):** Add `github.com/omnigent-ai/omnigent` as a **git submodule**; a build script builds
the `ap-web` embed from the submodule and vendors the `OmnigentApp` artifact into the VS Code extension.

Implementation outline (next chunk, after A5–A9 lands):
- Add submodule at `third_party/omnigent` (pinned commit = the ap-web build provenance).
- `vscode/scripts/build-apweb.*`: `cd third_party/omnigent/ap-web && npm ci && <embed build via
  vite.embed.config.ts>`; copy the `OmnigentApp` artifact → `vscode/media/apweb/omnigent-app.js`;
  record the submodule SHA in `vscode/apweb-pin.json` (replaces the `TBD-A6` placeholder).
- Bootstrap (A6) imports `OmnigentApp` from the vendored artifact and supplies React 18 +
  react-router-dom 6.4.x as the externalized runtime (per the A6a gate finding).
- Keep the dev-fallback placeholder for environments where the submodule/build isn't materialized.
- `.gitmodules` committed; the vendored `media/apweb/` artifact gitignored (rebuilt from the pinned submodule).

Caveat: building ap-web pulls a heavy toolchain (monaco/shiki/xterm). If the sandbox can't complete the
build, ship the wiring + script + dev-fallback and document the one-command build for a real environment.

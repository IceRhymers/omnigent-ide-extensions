# Building the ap-web Embed Bundle

The Omnigent VS Code extension can render the full `ap-web` SPA **same-origin** inside the
webview (`renderMode: "embed"`) by mounting `OmnigentApp` from a vendored bundle. This is the
path that makes native **copy / paste** work — the default `iframe` render mode hosts the server
in a cross-origin iframe, which on macOS does not receive Cmd+C/V keystrokes (upstream VS Code
bug microsoft/vscode#129178, #182642).

The bundle (`media/apweb/omnigent-embed.js` + `chunks/` + `assets/` + `omnigent-embed.css`) is a
**build artifact** produced from the `omnigent` monorepo's `ap-web` package. It is **not checked
into this repo** (it is gitignored) — it is reproduced from the pinned submodule.

## Quick path (recommended)

From the repo root:

```sh
make submodule   # init/sync third_party/omnigent at the pinned SHA
make embed        # build ap-web embed + React vendor bundles + webview bootstrap
```

`make embed` runs the three steps below and leaves everything under `vscode/media/apweb/` and
`vscode/media/bootstrap/`. Then set `"omnigent.renderMode": "embed"` in VS Code settings.

## What `make embed` does

### 1. Build the ap-web embed bundle (from the submodule)

```sh
cd third_party/omnigent/ap-web
npm install
npm run build:embed     # vite build --config vite.embed.config.ts -> dist-embed/
```

This emits an ESM intermediate:

- `dist-embed/omnigent-embed.js` — the entry (exports `OmnigentApp`, `setOmnigentHostConfig`)
- `dist-embed/omnigent-embed.css` — one scoped stylesheet (every selector prefixed `.omnigent-app`)
- `dist-embed/chunks/*.js` — code-split chunks (Monaco, shiki grammars, mermaid, … stay lazy)
- `dist-embed/assets/*` — the Monaco editor worker + any wasm

React / ReactDOM / react/jsx-runtime / react-router(-dom) are left as **bare externals** — the
host supplies them. (See the header comment in `vite.embed.config.ts`.)

The bundle is then copied into `vscode/media/apweb/`:

```sh
cp -R third_party/omnigent/ap-web/dist-embed/. vscode/media/apweb/
```

The dynamic `import("./chunks/*")` and the Monaco worker are **relative**, so they resolve to
webview-resource URIs under `media/apweb/` — the extension already lists `media/apweb`,
`media/apweb/chunks`, and `media/apweb/assets` in `localResourceRoots` (see
`src/panel/host.ts: embedLocalResourceRoots`). No second bundler is involved; the raw Vite
intermediate is loaded directly.

> **Note:** This intermediate is normally re-ingested by the monolith's rspack. Loading it
> directly in a webview works for the chat surface; Monaco/xterm workers are deferred (lazy) and
> may need follow-up CSP/worker work.

### 2. Build the React vendor bundles

```sh
cd vscode && npm run build:vendor    # scripts/build-vendor.js -> media/apweb/vendor/*.js
```

These are the `react`, `react-dom`, `react-dom/client`, `react/jsx-runtime`, `react-router`, and
`react-router-dom` bundles the webview import-map resolves the embed's bare externals to. They
must match the versions in `apweb-pin.json` so the embed and bootstrap share **one** React +
react-router instance.

### 3. Build the webview bootstrap

```sh
cd vscode && npm run build:bootstrap  # scripts/build-bootstrap.js -> media/bootstrap/bootstrap.js
```

The bootstrap (`media/bootstrap/bootstrap.ts`) receives the `omnigent/init` handshake
(server URL + token + route), installs the host fetcher (token stays in a closure — never in a
URL), then dynamically `import("omnigent-embed")` and mounts `<MemoryRouter><OmnigentApp/></…>`.

## Updating `apweb-pin.json`

The submodule SHA IS the artifact's behavior, so pin it. After re-syncing the submodule:

```json
{
  "apweb": {
    "repo": "github.com/omnigent-ai/omnigent",
    "buildSha": "<git rev-parse HEAD in third_party/omnigent>",
    "version": "<git describe / ap-web package.json version>",
    "entry": "omnigent-embed.js"
  },
  "externals": {
    "react": "<version ap-web built against>",
    "react-dom": "<…>",
    "react-router": "<…>",
    "react-router-dom": "<…>"
  }
}
```

## Dev fallback

If `media/apweb/omnigent-embed.js` is absent, the webview bootstrap renders a human-readable
placeholder explaining how to build it (see `media/bootstrap/bootstrap.ts: renderPlaceholder`).
The extension still activates, type-checks, and tests pass — `type-check` and `test` do **not**
require the bundle, and the default `iframe` render mode does not need it either.

# Building the ap-web Embed Bundle

The Omnigent VS Code extension embeds the `ap-web` SPA via `OmnigentApp` (Option B). The bundle
(`media/apweb/omnigent-app.js`) is **not checked into this repo** — it is an external build input
produced from the `omnigent` monorepo's `ap-web` package.

## Prerequisites

- Access to `github.com/omnigent-ai/omnigent` (the omnigent monorepo)
- Node ≥18, npm ≥9

## Steps

```sh
# 1. Clone (or pull) the omnigent monorepo
git clone https://github.com/omnigent-ai/omnigent /tmp/omnigent
cd /tmp/omnigent

# 2. Record the SHA you are pinning (load-bearing — this IS the artifact's behavior)
git rev-parse HEAD   # e.g. abc1234...

# 3. Install ap-web dependencies
cd ap-web
npm install

# 4. Build the embed bundle
#    ap-web ships a vite.embed.config.ts that produces the embed-only build.
npx vite build --config vite.embed.config.ts

# 5. Copy the artifact into this repo
cp dist-embed/omnigent-app.js \
   /path/to/omnigent-ide-extensions/vscode/media/apweb/omnigent-app.js

# 6. Record the SHA + version in apweb-pin.json
#    Also pin the React + react-router-dom versions ap-web was built with.
```

## Updating apweb-pin.json

After copying the bundle, update `vscode/apweb-pin.json`:

```json
{
  "apweb": {
    "repo": "github.com/omnigent-ai/omnigent",
    "buildSha": "<the git SHA from step 2>",
    "version": "<package.json version from ap-web/package.json>"
  },
  "externals": {
    "react": "<version from ap-web/package.json>",
    "react-dom": "<version from ap-web/package.json>",
    "react-router-dom": "<version from ap-web/package.json>"
  }
}
```

## Why the bundle is not checked in

- It is a build artifact (large binary-ish JS).
- The bundled ap-web build SHA/version IS this artifact's behavior (R10); pinning the SHA in
  `apweb-pin.json` + README makes the coupling explicit and auditable.
- On a server API bump, re-pin + re-test AC5 (event-class rendering).

## Dev fallback

If `media/apweb/omnigent-app.js` is absent, the webview bootstrap renders a
human-readable placeholder explaining the situation. The extension still activates,
type-checks, and tests pass — the `npm run type-check` and `npm test` steps do NOT
require the bundle.

## React / react-router-dom externals

The `ap-web` embed build (`embed.tsx`) externalizes `react`, `react-dom`, and
`react-router-dom` as bare externals — the HOST (this bootstrap) must provide
React 18 + react-router-dom 6.4.x at runtime. The bootstrap build
(`scripts/build-bootstrap.js`) bundles these into `media/bootstrap/bootstrap.js`.

Install the peer packages before running the bootstrap build:

```sh
cd vscode
npm install --save-dev react@18 react-dom@18 react-router-dom@6
```

Then rebuild the bootstrap:

```sh
node scripts/build-bootstrap.js
```

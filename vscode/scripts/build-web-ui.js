// Builds the Omnigent web app into dist/web-ui. A Databricks workspace serves
// only the Omnigent API, so the proxy serves this copy (src/proxy/localApp.ts).
// VITE_DATABRICKS_WORKSPACE makes it address host traffic to the replica that
// holds the host, as a workspace needs (isDatabricksWorkspace, web/src/lib/host.ts).
//
// The app's source is the pinned omnigent submodule (third_party/omnigent/web),
// built with its own Vite install and config. Vite's `build.license` (not a CLI
// flag) writes the bundled dependencies' licenses, which are moved to
// dist/web-ui-licenses.md so the proxy never serves them.
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const extensionDir = path.resolve(__dirname, "..");
const webDir = path.resolve(extensionDir, "../third_party/omnigent/web");
// Its own directory: emptyOutDir must never clear dist/extension.js.
const outDir = path.join(extensionDir, "dist", "web-ui");
const licensesOut = path.join(extensionDir, "dist", "web-ui-licenses.md");
const viteDir = path.join(webDir, "node_modules", "vite");

function fail(message) {
  console.error(`[build-web-ui] ${message}`);
  process.exit(1);
}

async function loadVite() {
  const manifest = path.join(viteDir, "package.json");
  if (!fs.existsSync(manifest)) {
    fail(
      `${viteDir} is missing; install the web app's dependencies: \`make web-deps\` from the repository root`,
    );
  }
  const entry = JSON.parse(fs.readFileSync(manifest, "utf8")).exports["."];
  const file = typeof entry === "string" ? entry : (entry.import?.default ?? entry.import);
  return import(pathToFileURL(path.join(viteDir, file)).href);
}

async function main() {
  if (!fs.existsSync(path.join(webDir, "package.json"))) {
    fail(`${webDir} is missing; run \`make submodule\` from the repository root.`);
  }
  const vite = await loadVite();

  process.env.VITE_DATABRICKS_WORKSPACE = "true";
  // web/vite.config.ts reads these for its dev proxy and would look up a token.
  delete process.env.OMNIGENT_URL;
  delete process.env.OMNIGENT_AUTH_TOKEN;
  process.chdir(webDir);

  await vite.build({
    root: webDir,
    configFile: path.join(webDir, "vite.config.ts"),
    build: { outDir, emptyOutDir: true, license: true },
  });

  const licenses = path.join(outDir, ".vite", "license.md");
  if (!fs.existsSync(licenses)) {
    fail(`Vite did not write ${licenses}`);
  }
  fs.renameSync(licenses, licensesOut);
  const metaDir = path.dirname(licenses);
  if (fs.readdirSync(metaDir).length === 0) {
    fs.rmdirSync(metaDir);
  }
  console.log(`[build-web-ui] wrote ${path.relative(extensionDir, licensesOut)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

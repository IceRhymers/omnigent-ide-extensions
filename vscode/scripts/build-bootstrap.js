/**
 * Bundles media/bootstrap/bootstrap.ts -> media/bootstrap/bootstrap.js
 * as ESM for the VS Code webview.
 *
 * All bare specifiers ("react", "react-dom/client", "react-router-dom",
 * "omnigent-embed") are kept EXTERNAL so the webview import-map resolves
 * them to vendor/ and apweb/ WebviewURIs at runtime.
 * This guarantees the embed and bootstrap share the SAME React instance.
 *
 * Usage:
 *   node scripts/build-bootstrap.js [--production] [--watch]
 */
const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");

const root = path.join(__dirname, "..");
const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [path.join(root, "media", "bootstrap", "bootstrap.ts")],
  bundle: true,
  outfile: path.join(root, "media", "bootstrap", "bootstrap.js"),
  platform: "browser",
  format: "esm",
  target: "es2020",
  // Keep bare specifiers external — resolved by the import-map at runtime.
  external: [
    "react",
    "react-dom",
    "react-dom/client",
    "react/jsx-runtime",
    "react-router",
    "react-router-dom",
    "omnigent-embed",
  ],
  sourcemap: !production,
  minify: production,
  logLevel: "info",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
};

async function main() {
  fs.mkdirSync(path.join(root, "media", "bootstrap"), { recursive: true });
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log("[build-bootstrap] watching...");
  } else {
    await esbuild.build(options);
    console.log("[build-bootstrap] bootstrap.js (ESM, externals via import-map)");
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

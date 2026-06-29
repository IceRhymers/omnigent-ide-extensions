/**
 * Builds self-contained browser ESM vendor bundles for the React externals that
 * the ap-web embed (omnigent-embed.js) leaves as bare specifiers.
 *
 * The import-map in the webview HTML resolves:
 *   "react"             -> media/apweb/vendor/react.js
 *   "react-dom"         -> media/apweb/vendor/react-dom.js
 *   "react-dom/client"  -> media/apweb/vendor/react-dom-client.js
 *   "react/jsx-runtime" -> media/apweb/vendor/jsx-runtime.js
 *   "react-router"      -> media/apweb/vendor/react-router.js
 *   "react-router-dom"  -> media/apweb/vendor/react-router-dom.js
 *
 * These files are generated artifacts → kept under media/apweb/ (gitignored).
 * Pinned versions: react/react-dom 18.3.1, react-router/react-router-dom 6.30.4.
 *
 * Usage:
 *   node scripts/build-vendor.js [--production]
 */
const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "media", "apweb", "vendor");
const production = process.argv.includes("--production");

fs.mkdirSync(outDir, { recursive: true });

const common = {
  bundle: true,
  format: "esm",
  platform: "browser",
  sourcemap: !production,
  minify: production,
  define: { "process.env.NODE_ENV": '"production"' },
};

/** @type {Array<import('esbuild').BuildOptions>} */
const builds = [
  // react — fully self-contained (no externals)
  {
    ...common,
    entryPoints: [require.resolve("react")],
    outfile: path.join(outDir, "react.js"),
  },
  // react-dom — marks react external (resolved via import map at runtime)
  {
    ...common,
    entryPoints: [require.resolve("react-dom")],
    outfile: path.join(outDir, "react-dom.js"),
    external: ["react"],
  },
  // react-dom/client — same external treatment
  {
    ...common,
    entryPoints: [require.resolve("react-dom/client")],
    outfile: path.join(outDir, "react-dom-client.js"),
    external: ["react", "react-dom"],
  },
  // react/jsx-runtime
  {
    ...common,
    entryPoints: [require.resolve("react/jsx-runtime")],
    outfile: path.join(outDir, "jsx-runtime.js"),
    external: ["react"],
  },
  // react-router — resolve the ESM build via mainFields/conditions instead of the
  // CJS main that require.resolve() returns. Pointing esbuild at the absolute CJS
  // file bypasses mainFields and produced a bundle whose ONLY export was
  // `export default require_main()` — no named exports — so
  // `import { MemoryRouter } from "react-router(-dom)"` threw at runtime. A stdin
  // `export *` entry lets esbuild resolve the package's ESM build and emit real
  // named exports.
  {
    ...common,
    stdin: {
      contents: `export * from "react-router";`,
      resolveDir: root,
      loader: "js",
      sourcefile: "react-router-vendor-entry.js",
    },
    outfile: path.join(outDir, "react-router.js"),
    external: ["react", "react-dom"],
    mainFields: ["module", "browser", "main"],
    conditions: ["import", "module", "browser", "default"],
  },
  // react-router-dom — same ESM-resolution fix. Its ESM build does
  // `export * from "react-router"`, kept external here so the import-map dedupes
  // to the single react-router instance; the browser forwards the core names
  // (MemoryRouter, useNavigate, Routes, Link, …) through to vendor/react-router.js.
  {
    ...common,
    stdin: {
      contents: `export * from "react-router-dom";`,
      resolveDir: root,
      loader: "js",
      sourcefile: "react-router-dom-vendor-entry.js",
    },
    outfile: path.join(outDir, "react-router-dom.js"),
    external: ["react", "react-dom", "react-router"],
    mainFields: ["module", "browser", "main"],
    conditions: ["import", "module", "browser", "default"],
  },
];

async function main() {
  await Promise.all(builds.map((opts) => esbuild.build(opts)));
  console.log(
    "[build-vendor] vendor bundles written to",
    path.relative(root, outDir),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

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
  // react-router
  {
    ...common,
    entryPoints: [require.resolve("react-router")],
    outfile: path.join(outDir, "react-router.js"),
    external: ["react", "react-dom"],
  },
  // react-router-dom
  {
    ...common,
    entryPoints: [require.resolve("react-router-dom")],
    outfile: path.join(outDir, "react-router-dom.js"),
    external: ["react", "react-dom", "react-router"],
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

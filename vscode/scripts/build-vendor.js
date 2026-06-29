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
 * ── Why this is not just `entryPoints: [require.resolve(pkg)]` ────────────────
 * The webview loads these bundles as separate ESM files and the embed/bootstrap
 * import NAMED bindings from them (`import { useState } from "react"`,
 * `import { createRoot } from "react-dom/client"`, `import { jsx } from
 * "react/jsx-runtime"`, …). Those bindings are resolved by the browser at LINK
 * time, so each bundle must expose real STATIC named exports.
 *
 * Two gotchas, two strategies:
 *  1. CJS-only packages (react, react-dom, react-dom/client, react/jsx-runtime):
 *     bundling the CJS entry yields a default-only bundle (`export default …`)
 *     because CJS export names aren't statically knowable, and `export *` from
 *     CJS produces RUNTIME re-exports, not the static bindings the browser needs.
 *     Fix: read the package's actual export keys via `require()` at build time
 *     and generate explicit `export const <name> = _m[<name>]` bindings. This is
 *     drift-proof (no hand-maintained name list) and bulletproof (every real key
 *     becomes a static export).
 *  2. react-router / react-router-dom ship a real ESM build, so a stdin
 *     `export * from "<pkg>"` resolved via mainFields/conditions forwards their
 *     static named exports directly. `require.resolve()` would instead pin the
 *     CJS main and reintroduce gotcha #1.
 *
 * react stays external wherever a downstream package needs it so the import-map
 * dedupes everything to a SINGLE react / react-dom / react-router instance.
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

/**
 * Build a stdin entry that re-exports a CJS package as real STATIC named exports.
 * Reads the package's actual export keys at build time (so the list can never
 * drift from the installed version) and emits `export const <key> = _m[<key>]`
 * for each valid-identifier key, plus the default (the module.exports object).
 */
function cjsNamedExportEntry(specifier) {
  const mod = require(specifier);
  const keys = Object.keys(mod).filter(
    (k) => k !== "default" && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k),
  );
  return [
    `import _m from ${JSON.stringify(specifier)};`,
    `export default _m;`,
    ...keys.map((k) => `export const ${k} = _m[${JSON.stringify(k)}];`),
  ].join("\n");
}

/**
 * Banner that resolves external `require(...)` calls left inside esbuild's lazy
 * __commonJS wrappers. Large CJS deps (notably react-dom) call require("react")
 * inside a deferred wrapper; with react external + ESM output, esbuild can't
 * hoist it to a top-level import and emits a throwing __require shim
 * (`Dynamic require of "react" is not supported`) that breaks in Node AND the
 * browser. esbuild's __require delegates to a `require` in scope when one exists,
 * so we declare a MODULE-SCOPED require() returning the real ESM-imported
 * external namespace (import-map resolved → the single shared react/react-dom
 * instance). No globals. (ap-web's vite.embed.config solves the same problem for
 * its rspack output via the resolveExternalCjsRequire plugin.)
 */
function externalRequireBanner(external) {
  if (external.length === 0) return undefined;
  const imports = external
    .map((id, i) => `import * as __ext${i} from ${JSON.stringify(id)};`)
    .join("\n");
  const cases = external
    .map((id, i) => `if (id === ${JSON.stringify(id)}) return __ext${i}.default ?? __ext${i};`)
    .join(" ");
  return `${imports}\nvar require = (id) => { ${cases} throw new Error("vendor require: unexpected " + id); };`;
}

/**
 * Externalize ONLY exact specifiers, never their subpaths. esbuild's built-in
 * `external: ["react-dom"]` also externalizes `react-dom/client` — which, for the
 * react-dom-client bundle whose ENTRY *is* `react-dom/client`, makes it import
 * itself (the import-map resolves `react-dom/client` back to this file →
 * circular self-import → default is undefined). This plugin externalizes the
 * exact package ids (so they resolve to the single shared instance via the
 * import-map) while letting subpaths like `react-dom/client` be bundled.
 */
function exactExternalPlugin(specifiers) {
  const set = new Set(specifiers);
  return {
    name: "exact-external",
    setup(build) {
      build.onResolve({ filter: /^[^.]/ }, (args) =>
        set.has(args.path) ? { path: args.path, external: true } : null,
      );
    },
  };
}

/** esbuild options for a CJS package -> static-named-export ESM bundle. */
function cjsBundle({ name, specifier, external = [] }) {
  const banner = externalRequireBanner(external);
  return {
    ...common,
    stdin: {
      contents: cjsNamedExportEntry(specifier),
      resolveDir: root,
      loader: "js",
      sourcefile: `${name}-vendor-entry.js`,
    },
    outfile: path.join(outDir, `${name}.js`),
    // Exact-match externals only (see exactExternalPlugin); do NOT use esbuild's
    // `external` option here, which would also externalize subpaths.
    plugins: [exactExternalPlugin(external)],
    ...(banner ? { banner: { js: banner } } : {}),
  };
}

/** esbuild options for an ESM package -> forwarded `export *` bundle. */
function esmReexport({ name, specifier, external = [] }) {
  return {
    ...common,
    stdin: {
      contents: `export * from ${JSON.stringify(specifier)};`,
      resolveDir: root,
      loader: "js",
      sourcefile: `${name}-vendor-entry.js`,
    },
    outfile: path.join(outDir, `${name}.js`),
    external,
    // Resolve the package's ESM build, NOT the CJS main require.resolve() returns.
    mainFields: ["module", "browser", "main"],
    conditions: ["import", "module", "browser", "default"],
  };
}

/** @type {Array<import('esbuild').BuildOptions>} */
const builds = [
  // CJS-only packages: explicit static named exports from real runtime keys.
  cjsBundle({ name: "react", specifier: "react" }), // self-contained (no externals)
  cjsBundle({ name: "react-dom", specifier: "react-dom", external: ["react"] }),
  cjsBundle({
    name: "react-dom-client",
    specifier: "react-dom/client",
    external: ["react", "react-dom"],
  }),
  cjsBundle({ name: "jsx-runtime", specifier: "react/jsx-runtime", external: ["react"] }),
  // ESM packages: forward their static named exports; keep react-router external
  // for react-router-dom so the import-map dedupes to one react-router instance.
  esmReexport({ name: "react-router", specifier: "react-router", external: ["react", "react-dom"] }),
  esmReexport({
    name: "react-router-dom",
    specifier: "react-router-dom",
    external: ["react", "react-dom", "react-router"],
  }),
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

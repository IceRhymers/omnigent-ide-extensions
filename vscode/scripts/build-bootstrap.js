/**
 * Bundles media/bootstrap/bootstrap.ts -> media/bootstrap/bootstrap.js
 * for the VS Code webview.
 *
 * The bootstrap must include React 18 + react-router-dom 6.4.x (the ap-web embed
 * externalizes these as bare externals expecting the host to provide them).
 * omnigent-app.js is NOT bundled here — it is loaded via dynamic import at runtime.
 *
 * Usage:
 *   node scripts/build-bootstrap.js [--production]
 *   node scripts/build-bootstrap.js --watch
 */
const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");

const root = path.join(__dirname, "..");
const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

// Verify required npm packages are installed before attempting build.
const requiredPkgs = ["react", "react-dom", "react-router-dom"];
const missing = requiredPkgs.filter((pkg) => {
  try {
    require.resolve(path.join(root, "node_modules", pkg));
    return false;
  } catch {
    return true;
  }
});
if (missing.length > 0) {
  console.warn(
    `[build-bootstrap] WARNING: missing peer packages: ${missing.join(", ")}. ` +
      `Run: npm install --save-dev react@18 react-dom@18 react-router-dom@6. ` +
      `Bootstrap will render the dev-fallback placeholder until these are installed.`,
  );
}

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [path.join(root, "media", "bootstrap", "bootstrap.ts")],
  bundle: true,
  outfile: path.join(root, "media", "bootstrap", "bootstrap.js"),
  platform: "browser",
  format: "iife",
  target: "es2020",
  // omnigent-app.js is loaded via dynamic import at runtime; keep it external.
  external: ["../apweb/omnigent-app.js"],
  // React 18 + react-router-dom are bundled IN here (ap-web expects them from the host).
  // They are NOT external — we include them so the webview has them at runtime.
  sourcemap: !production,
  minify: production,
  logLevel: "info",
  define: {
    "process.env.NODE_ENV": production ? '"production"' : '"development"',
  },
};

async function main() {
  // Ensure output directory exists.
  fs.mkdirSync(path.join(root, "media", "bootstrap"), { recursive: true });

  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log("[build-bootstrap] watching...");
  } else {
    await esbuild.build(options);
    console.log("[build-bootstrap] bootstrap build complete");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

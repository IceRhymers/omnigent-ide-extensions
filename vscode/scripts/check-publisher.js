// Fails while the Marketplace publisher ID is still the placeholder, so a
// release can't go out under it. Run by the release workflow before packaging;
// see PUBLISHING.md for where to replace it.
const fs = require("node:fs");
const path = require("node:path");

const PLACEHOLDER = "publisher-id-placeholder";
const root = path.resolve(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
// These two explain the placeholder rather than use it.
const SKIP_FILES = new Set([
  path.join(root, "scripts", "check-publisher.js"),
  path.join(root, "PUBLISHING.md"),
]);

function* files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        yield* files(full);
      }
    } else if (entry.isFile() && !SKIP_FILES.has(full) && !entry.name.endsWith(".vsix")) {
      yield full;
    }
  }
}

const hits = [];
for (const file of files(root)) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    if (line.includes(PLACEHOLDER)) {
      hits.push(`${path.relative(root, file)}:${index + 1}`);
    }
  });
}

if (hits.length > 0) {
  console.error(`[check-publisher] "${PLACEHOLDER}" must be replaced with the real publisher ID:`);
  for (const hit of hits) {
    console.error(`  ${hit}`);
  }
  process.exit(1);
}
const { publisher } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
console.log(`[check-publisher] publisher: ${publisher}`);

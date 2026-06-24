import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      // Stub the vscode module so unit/integration tests run without an IDE host.
      // The pure logic under test never calls into vscode; only the thin adapter
      // wrappers (vscodeSettings.ts, OmnigentViewProvider.ts, registerXxx()) do,
      // and those are excluded from the unit-test surface.
      vscode: resolve(__dirname, "src/test/__mocks__/vscode.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    // Unit tests must not require the VS Code host or network (AC9 gate).
    environment: "node",
  },
});

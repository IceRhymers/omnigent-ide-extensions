/**
 * Minimal vscode API stub for vitest unit/integration tests.
 * Only the symbols actually imported by the modules under test need to be here.
 * The pure logic (csp, html, messages, api/client, commands/*) never calls
 * into vscode — only the thin adapter wrappers do, and those are not exercised
 * by unit tests. This stub exists solely to satisfy the module resolver.
 */

export const window = {
  createOutputChannel: () => ({ appendLine: () => {}, dispose: () => {} }),
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  activeColorTheme: { kind: 2 /* Dark */ },
  activeTextEditor: undefined,
};

export const workspace = {
  getConfiguration: () => ({ get: (_key: string, def: unknown) => def }),
  workspaceFolders: undefined,
  registerTextDocumentContentProvider: () => ({ dispose: () => {} }),
};

export const commands = {
  registerCommand: (_id: string, _fn: unknown) => ({ dispose: () => {} }),
  executeCommand: async () => undefined,
};

export const Uri = {
  parse: (s: string) => ({ toString: () => s, fsPath: s }),
  joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
    toString: () => [base.fsPath, ...parts].join("/"),
    fsPath: [base.fsPath, ...parts].join("/"),
  }),
};

export const EventEmitter = class {
  event = () => ({ dispose: () => {} });
  fire() {}
  dispose() {}
};

export const StatusBarAlignment = { Left: 1, Right: 2 };
export const ColorThemeKind = { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 };

export const WebviewViewProvider = class {};

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
  showQuickPick: async () => undefined,
  // Default stub panel; tests that exercise the editor panel override this with
  // vi.spyOn to inject a fake WebviewPanel and assert on its webview.
  createWebviewPanel: (_id: string, _title: string, _col: unknown, _opts: unknown) => ({
    webview: { html: "", postMessage: () => true, cspSource: "vscode-resource:" },
    reveal: () => {},
    onDidDispose: (_cb: () => void) => ({ dispose: () => {} }),
    dispose: () => {},
  }),
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
export const ViewColumn = { Active: -1, Beside: -2, One: 1, Two: 2 };
export const ColorThemeKind = { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 };
export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };

export const TreeItem = class {
  label: string;
  collapsibleState: number;
  description?: string;
  tooltip?: unknown;
  iconPath?: unknown;
  contextValue?: string;
  command?: unknown;
  id?: string;
  constructor(label: string, collapsibleState = 0) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
};

export const ThemeIcon = class {
  id: string;
  constructor(id: string) {
    this.id = id;
  }
};

export const MarkdownString = class {
  value: string;
  constructor(value = "") {
    this.value = value;
  }
};

export const WebviewViewProvider = class {};

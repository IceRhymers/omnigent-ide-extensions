/**
 * A5/A6 — WebviewViewProvider for the Omnigent activity-bar panel.
 *
 * This is the thin VS Code adapter layer. All pure logic lives in
 * csp.ts / html.ts / messages.ts so it is testable without an IDE host.
 *
 * Responsibilities:
 *  - Own the webview lifecycle (resolveWebviewView, dispose).
 *  - Generate a fresh nonce + CSP for every panel load.
 *  - Build the HTML with the bootstrap script URI.
 *  - Post the typed InitMessage to the webview after load.
 *  - Accept NavigateMessage commands from the command layer (A8).
 *  - Forward Webview→Host messages to registered listeners.
 */
import * as vscode from "vscode";
import * as crypto from "node:crypto";
import { buildCsp, wsOriginsForServer } from "./csp";
import { buildWebviewHtml } from "./html";
import type { ExtensionToWebview, WebviewToExtension } from "./messages";
import type { ServerTarget } from "../config";
import type { ResolvedToken } from "../auth/precedence";
import { redact } from "../redact";

export const VIEW_ID = "omnigent.panel";

export class OmnigentViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _output: vscode.OutputChannel;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    output: vscode.OutputChannel,
  ) {
    this._output = output;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, "media"),
      ],
    };

    // Listen for webview→host messages.
    webviewView.webview.onDidReceiveMessage((msg: WebviewToExtension) => {
      if (msg.type === "omnigent/ready") {
        this._output.appendLine("[omnigent] webview ready");
      } else if (msg.type === "omnigent/error") {
        this._output.appendLine(`[omnigent] webview error: ${msg.message}`);
      }
    });

    this._render(webviewView.webview);
  }

  /** Called by the command layer (A8) to send a navigate message. */
  postMessage(msg: ExtensionToWebview): boolean {
    if (!this._view) return false;
    this._view.webview.postMessage(msg);
    return true;
  }

  /** Called by A8 / extension.ts to initialise with resolved server+auth. */
  init(target: ServerTarget, resolved: ResolvedToken, route = "/"): void {
    if (!this._view) return;
    const token = resolved.source === "manual" || resolved.source === "file"
      ? (resolved as { token: string }).token
      : undefined;
    this._output.appendLine(
      `[omnigent] posting init (origin=${target.origin}, tokenSource=${resolved.source}, token=${redact(token)})`,
    );
    const msg: ExtensionToWebview = {
      type: "omnigent/init",
      serverUrl: target.baseUrl,
      token,
      route,
      isDarkMode: vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark,
    };
    this._view.webview.postMessage(msg);
  }

  private _render(webview: vscode.Webview): void {
    const nonce = crypto.randomBytes(16).toString("base64url");
    const csp = buildCsp({
      serverOrigin: "http://127.0.0.1:6767", // placeholder; real target posted via init()
      wsOrigins: wsOriginsForServer("http://127.0.0.1:6767"),
      nonce,
      cspSource: webview.cspSource,
    });

    // Bootstrap script URI — the webview-resource URI for the bundled bootstrap.
    const bootstrapUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", "bootstrap", "bootstrap.js"))
      .toString();

    const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
    webview.html = buildWebviewHtml({ csp, nonce, bootstrapUri, isDarkMode: isDark });
    this._output.appendLine(`[omnigent] webview rendered (nonce=${nonce.slice(0, 8)}...)`);
  }
}

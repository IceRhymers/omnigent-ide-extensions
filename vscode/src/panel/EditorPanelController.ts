/**
 * Sole owner of the editor-beside Omnigent `WebviewPanel` AND the resolved
 * `{ target, token, route }` that drives its render.
 *
 * Before this refactor that state was split across the former sidebar webview
 * provider (target/token/route + re-render-if-open) and `registerOpenPanel`'s
 * module-local `editorPanel` singleton + `renderEditorPanel` closure. Collapsing
 * both into a single owner makes the editor panel the one full-app surface and
 * gives every entry point (`omnigent.open`, `openSession`, `openSessionFromTree`)
 * a single navigation path — eliminating the latent "post to the sidebar webview"
 * bug.
 *
 * Render logic is shared with the (now-only) host via panel/host.ts (renderInto);
 * the iframe vs embed decision lives there.
 *
 * This is the ONLY `createWebviewPanel` call in the codebase.
 */
import * as vscode from "vscode";
import { embedLocalResourceRoots, renderInto, renderResolvingHtml } from "./host";
import type { ExtensionToWebview } from "./messages";
import type { ServerTarget } from "../config";
import { readSettings } from "../config/vscodeSettings";

export class EditorPanelController {
  private panel?: vscode.WebviewPanel;
  private route = "/";
  private resolved?: { target: ServerTarget; token?: string };

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly output: vscode.OutputChannel,
  ) {}

  /**
   * Store the resolved server target + token (replaces the old provider's init).
   * Called from extension.ts once the server + auth resolve. If a panel is already
   * open (e.g. opened during the async auth window), re-render it so it doesn't
   * stick on the "Resolving…" placeholder (C1).
   */
  setResolved(target: ServerTarget, token?: string): void {
    this.resolved = { target, token };
    if (this.panel) {
      this.render(this.panel.webview);
    }
  }

  /**
   * Create-or-reveal the editor-beside panel and render it at the controller's
   * current route. Revealing an already-open panel must NOT reset an
   * already-navigated route back to "/" (C2): `this.route` is preserved.
   */
  ensure(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      this.render(this.panel.webview);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "omnigent",
      "Omnigent",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: embedLocalResourceRoots(this.extensionUri),
      },
    );
    this.panel = panel;
    panel.onDidDispose(() => {
      // Guard against a double-fire / a fire after the controller already
      // dropped this panel for a newer one (C3).
      if (this.panel === panel) {
        this.panel = undefined;
      }
    });
    this.render(panel.webview);
    this.output.appendLine("[omnigent] opened editor-beside panel");
  }

  /**
   * Navigate the editor panel to `route`. Sole mutator of `this.route`. Ensures
   * the panel exists, then drives navigation the same way the old code did:
   *  - iframe path: `renderInto` re-renders the iframe at the routed URL.
   *  - embed path: post `{ type: "omnigent/navigate", route }` to THIS panel's
   *    webview (drives the OmnigentApp router without an iframe reload).
   * `ensure()` already calls `render` (which, for embed, posts the init handshake
   * carrying the route). The explicit navigate post below is the embed deep-link
   * for an already-mounted app and is harmless on the iframe path.
   */
  navigate(route: string): void {
    this.route = route;
    this.ensure();
    if (this.panel) {
      this.postMessage({ type: "omnigent/navigate", route });
    }
  }

  /** Whether the editor panel is currently open. */
  isOpen(): boolean {
    return this.panel !== undefined;
  }

  /** Dispose the panel and null the ref (idempotent). */
  dispose(): void {
    const panel = this.panel;
    this.panel = undefined;
    panel?.dispose();
  }

  /** Post a host→webview message to the editor panel, if open. */
  private postMessage(msg: ExtensionToWebview): boolean {
    if (!this.panel) return false;
    this.panel.webview.postMessage(msg);
    return true;
  }

  private render(webview: vscode.Webview): void {
    if (!this.resolved) {
      // No resolved target yet — show the placeholder until setResolved arrives.
      webview.html = renderResolvingHtml();
      return;
    }
    renderInto(webview, {
      target: this.resolved.target,
      extensionUri: this.extensionUri,
      renderMode: readSettings().renderMode,
      route: this.route,
      token: this.resolved.token,
      isDarkMode: vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark,
      log: (m) => this.output.appendLine(m),
    });
  }
}

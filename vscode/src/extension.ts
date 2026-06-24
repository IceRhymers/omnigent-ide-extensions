/**
 * Omnigent VS Code extension entry point (A1–A9 wired).
 *
 * activate() wires:
 *  - Config / discovery / auth (A1–A4)
 *  - WebviewView provider + CSP (A5)
 *  - Embed bootstrap handshake (A6)
 *  - send-selection command (A7)
 *  - open-session command + status bar (A8)
 *  - view/apply diffs command + SSE watch (A9)
 *
 * Remaining: A10 (vsce package).
 */
import * as vscode from "vscode";
import { discoverLocalServer, DEFAULT_HEALTH_TIMEOUT_MS } from "./discovery";
import { resolveServerTarget } from "./config";
import { readSettings } from "./config/vscodeSettings";
import { resolveToken } from "./auth";
import { redact, redactObject } from "./redact";
import { OmnigentViewProvider, VIEW_ID } from "./panel/OmnigentViewProvider";
import { makeSessionState } from "./commands/sessionState";
import { registerSendSelection } from "./commands/sendSelection";
import { registerOpenSession } from "./commands/openSession";
import { registerOpenPanel } from "./commands/openPanel";
import { registerDiffsCommand } from "./commands/diffs";
import type { ClientOptions } from "./api/client";

let output: vscode.OutputChannel | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  output = vscode.window.createOutputChannel("Omnigent");
  context.subscriptions.push(output);
  output.appendLine("[omnigent] activating");

  // ── Shared session state (A7/A8/A9 read this) ────────────────────────────
  const sessionState = makeSessionState();

  // ── A5/A6: WebviewView provider ──────────────────────────────────────────
  const provider = new OmnigentViewProvider(context.extensionUri, output);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // ── A7: send-selection command ────────────────────────────────────────────
  registerSendSelection(
    context,
    () => sessionState.clientOpts,
    () => sessionState.sessionId,
    output,
  );

  // ── A8: open-session command + status bar ─────────────────────────────────
  registerOpenSession(context, provider, sessionState, output);

  // ── A11: open-panel command (configurable right-side placement) ───────────
  registerOpenPanel(context, provider, output);

  // ── A9: diffs command + SSE watch ─────────────────────────────────────────
  const { stopSse: startSseWatch } = registerDiffsCommand(context, sessionState, output);

  // ── Foundation: resolve server + auth at activation ───────────────────────
  try {
    const settings = readSettings();
    const discovery = await discoverLocalServer(undefined, DEFAULT_HEALTH_TIMEOUT_MS);
    const resolution = resolveServerTarget(settings, {
      found: discovery.found,
      baseUrl: discovery.found ? discovery.baseUrl : undefined,
      health: discovery.found ? discovery.health : undefined,
    });

    if (resolution.status === "resolved") {
      const target = resolution.target;
      const { resolved } = await resolveToken(target.origin, settings.token || null);

      // Build the client options used by all commands.
      const clientOpts: ClientOptions = {
        baseUrl: target.baseUrl,
        token:
          resolved.source === "manual" || resolved.source === "file"
            ? (resolved as { token: string }).token
            : undefined,
      };
      sessionState.clientOpts = clientOpts;
      sessionState.hostType = target.hostType;

      output.appendLine(
        `[omnigent] target: ${JSON.stringify(
          redactObject({
            baseUrl: target.baseUrl,
            origin: target.origin,
            hostType: target.hostType,
            source: target.source,
            tokenSource: resolved.source,
            token: redact(resolved.source === "manual" || resolved.source === "file" ? "present" : ""),
          }),
        )}`,
      );

      // Post the init message so the webview knows what server to connect to.
      // (The panel may not be visible yet; postMessage queues until resolveWebviewView.)
      provider.init(target, resolved);

      // Start SSE watch if a session is already active (e.g. after reload).
      if (sessionState.sessionId) startSseWatch();
    } else {
      output.appendLine(`[omnigent] no server target (${resolution.reason}); configure omnigent.serverUrl`);
    }
  } catch (err) {
    output.appendLine(
      `[omnigent] init error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  output.appendLine("[omnigent] ready");
}

export function deactivate(): void {
  output?.appendLine("[omnigent] deactivating");
  output = undefined;
}

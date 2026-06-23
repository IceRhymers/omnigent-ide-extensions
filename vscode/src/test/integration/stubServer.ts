/**
 * Minimal in-process stub HTTP server for integration tests.
 * Uses Node's built-in http module (no external deps).
 *
 * Handlers are registered per-path and return { status, body }.
 * A request log captures every call so tests can assert Authorization headers.
 */
import * as http from "node:http";

export interface StubRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

export interface StubResponse {
  status: number;
  body: unknown;
}

export type HandlerFn = (req: StubRequest) => StubResponse | Promise<StubResponse>;

export class StubServer {
  private _server: http.Server;
  private _handlers = new Map<string, HandlerFn>();
  private _log: StubRequest[] = [];
  public port = 0;

  constructor() {
    this._server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks).toString();

      const stubreq: StubRequest = {
        method: req.method ?? "GET",
        path: req.url ?? "/",
        headers: req.headers as Record<string, string>,
        body,
      };
      this._log.push(stubreq);

      const key = `${stubreq.method} ${stubreq.path}`;
      const wildcardKey = stubreq.path; // path-only match
      const handler =
        this._handlers.get(key) ??
        this._handlers.get(wildcardKey) ??
        this._findPrefix(stubreq.method, stubreq.path);

      let stubresp: StubResponse;
      if (handler) {
        try {
          stubresp = await handler(stubreq);
        } catch (e) {
          stubresp = { status: 500, body: { error: String(e) } };
        }
      } else {
        stubresp = { status: 404, body: { error: `no handler for ${key}` } };
      }

      const bodyStr = JSON.stringify(stubresp.body);
      res.writeHead(stubresp.status, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(bodyStr),
      });
      res.end(bodyStr);
    });
  }

  private _findPrefix(method: string, path: string): HandlerFn | undefined {
    for (const [key, fn] of this._handlers.entries()) {
      const [km, kp] = key.split(" ");
      if (km === method && path.startsWith(kp)) return fn;
    }
    return undefined;
  }

  on(method: string, path: string, handler: HandlerFn): void {
    this._handlers.set(`${method} ${path}`, handler);
  }

  get requests(): StubRequest[] {
    return this._log;
  }

  lastRequest(method: string, pathPrefix: string): StubRequest | undefined {
    return [...this._log]
      .reverse()
      .find((r) => r.method === method && r.path.startsWith(pathPrefix));
  }

  clearLog(): void {
    this._log = [];
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this._server.listen(0, "127.0.0.1", () => {
        this.port = (this._server.address() as { port: number }).port;
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) =>
      this._server.close((err) => (err ? reject(err) : resolve())),
    );
  }

  baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }
}

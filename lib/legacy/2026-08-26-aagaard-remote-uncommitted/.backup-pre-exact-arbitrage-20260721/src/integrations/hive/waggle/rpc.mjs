// rpc — JSON-RPC 2.0 transport + node failover for Hive (spec docs/dev/notes/03-rpc-read-spec.md).
// Zero deps: real transport uses node:https. A `transport` may be injected for offline testing.
//
// Envelope (spec §1): { jsonrpc:"2.0", method:"<api>.<method>", params:<array|object>, id:<number> }.
// Errors surface three ways (spec §2): (1) network/transport failure, (2) non-2xx HTTP,
// (3) a JSON-RPC `error` object on HTTP 200. We retry-next-node on all of them, plus on an
// unparseable body. We do up to two full passes over the node list before giving up.

import https from "node:https";

// spec §3 — curated public mainnet API node base URLs.
export const DEFAULT_NODES = [
  "https://api.hive.blog",
  "https://api.deathwing.me",
  "https://api.openhive.network",
  "https://anyx.io",
  "https://hive-api.arcange.eu",
  "https://techcoderx.com",
  "https://rpc.mahdiyari.info",
  "https://api.c0ff33a.uk",
];

// Real HTTPS POST transport. Resolves { status, body }; rejects on network/timeout error.
// Header Content-Type: application/json; RPC served at the node root `/` (spec §2).
function httpsTransport(timeout) {
  return (url, bodyObject) =>
    new Promise((resolve, reject) => {
      const payload = Buffer.from(JSON.stringify(bodyObject), "utf8");
      const u = new URL(url);
      const controller = new AbortController();
      const options = {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname && u.pathname !== "" ? u.pathname : "/",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": payload.length,
        },
        signal: controller.signal,
      };
      const timer = setTimeout(() => controller.abort(), timeout);
      const req = https.request(options, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          clearTimeout(timer);
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") });
        });
      });
      req.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      req.write(payload);
      req.end();
    });
}

export class RpcClient {
  constructor({ nodes = DEFAULT_NODES, timeout = 8000, transport } = {}) {
    this.nodes = Array.isArray(nodes) && nodes.length ? [...nodes] : [...DEFAULT_NODES];
    this.timeout = timeout;
    // Injectable async (url, bodyObject) => { status, body } for tests; else real https.
    this.transport = transport || httpsTransport(timeout);
    this._id = 0; // numeric id, incremented per call
    this._start = 0; // round-robin start index, rotated per call so load spreads
  }

  // Build the JSON-RPC 2.0 envelope. Testable in isolation.
  buildEnvelope(method, params) {
    return { jsonrpc: "2.0", method, params, id: ++this._id };
  }

  // POST `method`/`params` to nodes in order from a rotating start, with failover.
  // Returns the JSON-RPC `result`; throws carrying the last error/message if all nodes fail.
  async call(method, params) {
    const envelope = this.buildEnvelope(method, params);
    const n = this.nodes.length;
    const start = this._start;
    this._start = (this._start + 1) % n; // rotate starting node for the next call

    let lastError = null;
    // Two full passes over the node list (spec §2: one pass, then a second pass).
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        const url = this.nodes[(start + i) % n];
        try {
          const res = await this.transport(url, envelope);
          // (2) non-2xx HTTP → next node.
          if (!res || typeof res.status !== "number" || res.status < 200 || res.status >= 300) {
            lastError = new Error(`HTTP ${res && res.status} from ${url}`);
            continue;
          }
          let parsed;
          try {
            parsed = JSON.parse(res.body);
          } catch (e) {
            // unparseable body → next node.
            lastError = new Error(`Unparseable body from ${url}: ${e.message}`);
            continue;
          }
          // (3) JSON-RPC error object on HTTP 200 → next node (spec §2: codes unreliable,
          // treat presence as the signal, default to retry next node).
          if (parsed && parsed.error) {
            const msg =
              (parsed.error && (parsed.error.message || JSON.stringify(parsed.error))) ||
              "JSON-RPC error";
            lastError = new Error(`RPC error from ${url}: ${msg}`);
            lastError.rpcError = parsed.error;
            continue;
          }
          return parsed ? parsed.result : undefined;
        } catch (err) {
          // (1) network/transport failure → next node.
          lastError = err;
          continue;
        }
      }
    }
    const err = new Error(
      `All ${n} nodes failed for ${method}: ${lastError ? lastError.message : "unknown error"}`,
    );
    err.lastError = lastError;
    if (lastError && lastError.rpcError) err.rpcError = lastError.rpcError;
    throw err;
  }
}

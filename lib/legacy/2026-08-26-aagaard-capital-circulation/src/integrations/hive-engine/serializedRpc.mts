// Provider-local Hive Engine contract reads. Every caller shares one FIFO
// slot so Promise.all composition cannot accidentally burst a gateway.

export type HiveEngineRow = Readonly<Record<string, unknown>>;
export type HiveEngineFindIndex = Readonly<{ readonly index: string; readonly descending: boolean }>;

export interface SerializedHiveEngineRpcOptions {
  readonly nodes: readonly string[];
  readonly timeoutMs: number;
  readonly attemptsPerNode?: number;
  readonly fetch?: typeof fetch;
}

function isRecord(value: unknown): value is HiveEngineRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createSerializedHiveEngineRpc(options: SerializedHiveEngineRpcOptions) {
  if (options.nodes.length === 0 || new Set(options.nodes).size !== options.nodes.length
    || options.nodes.some((node) => !/^https:\/\//u.test(node))
    || !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 250
    || !Number.isSafeInteger(options.attemptsPerNode ?? 1) || (options.attemptsPerNode ?? 1) < 1 || (options.attemptsPerNode ?? 1) > 3) {
    throw new TypeError("serialized Hive Engine RPC options are malformed");
  }
  const fetchImpl = options.fetch ?? fetch;
  const attempts = options.attemptsPerNode ?? 1;
  let nextId = 1;
  let tail: Promise<void> = Promise.resolve();

  async function withSlot<T>(read: () => Promise<T>): Promise<T> {
    const predecessor = tail;
    let release!: () => void;
    tail = new Promise<void>((resolvePromise) => { release = resolvePromise; });
    await predecessor;
    try { return await read(); }
    finally { release(); }
  }

  async function find(contract: string, table: string, query: HiveEngineRow, limit: number, offset = 0,
    indexes?: readonly HiveEngineFindIndex[]): Promise<readonly HiveEngineRow[]> {
    if (!/^[A-Za-z0-9.-]{1,50}$/u.test(contract) || !/^[A-Za-z0-9.-]{1,80}$/u.test(table)
      || !isRecord(query) || !Number.isSafeInteger(limit) || limit < 1 || limit > 1_000
      || !Number.isSafeInteger(offset) || offset < 0) throw new TypeError("Hive Engine find request is malformed");
    return await withSlot(async () => {
      let lastError: unknown;
      for (const node of options.nodes) {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
          try {
            const response = await fetchImpl(node, { method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "find",
                params: { contract, table, query, limit, offset, ...(indexes ? { indexes } : {}) } }), signal: controller.signal });
            const text = await response.text();
            if (!response.ok) throw new Error(`Hive Engine RPC ${node} HTTP ${response.status}`);
            let payload: unknown;
            try { payload = JSON.parse(text); }
            catch { throw new Error(`Hive Engine RPC ${node} returned non-JSON`); }
            if (!isRecord(payload)) throw new Error(`Hive Engine RPC ${node} returned non-object payload`);
            if (payload["error"] !== undefined) throw new Error(`Hive Engine ${contract}.${table} error: ${JSON.stringify(payload["error"])}`);
            if (!Array.isArray(payload["result"]) || !payload["result"].every(isRecord)) {
              throw new Error(`Hive Engine ${contract}.${table} returned malformed rows`);
            }
            return Object.freeze(payload["result"]);
          } catch (error) {
            lastError = error;
          } finally {
            clearTimeout(timeout);
          }
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    });
  }

  return Object.freeze({ find });
}

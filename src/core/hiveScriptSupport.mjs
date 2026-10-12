import { RpcClient } from "@red-cup-engineering/hive-blockchain-client-service/rpc.mjs";
import { engineTransactionReceipt } from "@red-cup-engineering/hive-blockchain-client-service/engine.mjs";

/**
 * Builds a `fail(message)` that throws an Error prefixed with the calling
 * script's own name, matching the per-script `fail` each observe/execute
 * script previously hand-rolled.
 *
 * @param {string} label - the script's own name, e.g. "unstake-token".
 * @returns {(message: string) => never}
 */
export function makeFail(label) {
  return function fail(message) { throw new Error(`${label}: ${message}`); };
}

/**
 * Calls one JSON-RPC 2.0 node with three attempts and linear backoff and returns `result`;
 * an exhausted budget goes to the caller's `fail` (or throws).
 *
 * @param {string} node - RPC endpoint URL.
 * @param {string} method - JSON-RPC method name.
 * @param {unknown} params - JSON-RPC params.
 * @param {{ timeoutMs?: number, backoffMs?: number, fail?: (message: string) => never }} [options]
 * @returns {Promise<unknown>}
 */
export async function rpc(node, method, params, options = {}) {
  const { timeoutMs = 8_000, backoffMs = 350, fail = (message) => { throw new Error(message); } } = options;
  try {
    return await new RpcClient({ nodes: [node], timeout: timeoutMs, passes: 3, backoffMs }).call(method, params);
  } catch (error) {
    return fail(`${node} ${method} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Reads one Hive-Engine contract table from one node through `rpc`; a non-array answer goes to
 * the caller's `fail`.
 *
 * @param {string} node
 * @param {string} contract
 * @param {string} table
 * @param {object} query
 * @param {{ limit?: number, indexes?: object[], timeoutMs?: number, backoffMs?: number, fail?: (message: string) => never }} [options]
 * @returns {Promise<object[]>}
 */
export async function engineFind(node, contract, table, query, { limit = 1000, indexes = [], ...options } = {}) {
  const fail = options.fail ?? ((message) => { throw new Error(message); });
  const rows = await rpc(node, "find", { contract, table, query, limit, offset: 0, indexes }, options);
  if (!Array.isArray(rows)) fail(`${node} returned a non-array ${contract}.${table} result`);
  return rows;
}

/**
 * Finds one Hive-Engine transaction on one node: the id itself, then its first child `<id>-0`
 * (how the node files a batched custom_json). Null when the node knows neither.
 *
 * @param {string} node
 * @param {string} txid
 * @param {{ timeoutMs?: number, backoffMs?: number }} [options]
 * @returns {Promise<{ row: unknown, candidate: string } | null>}
 */
export async function findEngineTransaction(node, txid, options = {}) {
  for (const candidate of [txid, `${txid}-0`]) {
    const row = await rpc(node, "getTransactionInfo", { txid: candidate }, { ...options, fail: undefined }).catch(() => null);
    if (row) return { row, candidate };
  }
  return null;
}

/**
 * One node's receipt for a Hive-Engine transaction (engineTransactionReceipt), or null while the
 * node does not know it yet; an error the transaction reports goes to the caller's `fail`.
 *
 * @param {string} node
 * @param {string} txid
 * @param {{ timeoutMs?: number, backoffMs?: number, fail?: (message: string) => never }} [options]
 */
export async function engineTransaction(node, txid, options = {}) {
  const found = await findEngineTransaction(node, txid, options);
  if (!found) return null;
  try { return engineTransactionReceipt(found.row, node, found.candidate); }
  catch (error) { return (options.fail ?? ((message) => { throw new Error(message); }))(error instanceof Error ? error.message : String(error)); }
}

/**
 * The value at least two providers answered identically, with the providers that answered it;
 * fewer than two in agreement goes to `fail`.
 *
 * @param {readonly { node: string, value: unknown }[]} rows
 * @param {(message: string) => never} fail
 * @param {string} [what] - what the providers were asked, for the refusal.
 */
export function providerMajority(rows, fail, what = "the evidence") {
  const groups = new Map();
  for (const row of rows) { const key = JSON.stringify(row.value); const group = groups.get(key) ?? []; group.push(row); groups.set(key, group); }
  const winner = [...groups.values()].sort((left, right) => right.length - left.length)[0] ?? [];
  if (winner.length < 2) fail(`fewer than two independent providers agree on ${what}`);
  return Object.freeze({ value: winner[0].value, providers: Object.freeze(winner.map((row) => row.node).sort()) });
}

/**
 * The single row of a result that must have exactly one (`required`) or at most one; any other
 * count goes to `fail`.
 *
 * @param {readonly unknown[]} rows
 * @param {string} label
 * @param {(message: string) => never} fail
 * @param {{ required?: boolean }} [options]
 */
export function oneRow(rows, label, fail, { required = true } = {}) {
  if (rows.length > 1 || (required && rows.length !== 1)) fail(`${label} requires ${required ? "exactly" : "at most"} one row, observed ${rows.length}`);
  return rows[0] ?? null;
}

/**
 * Parses the common `--account [--execute-one]` observe/execute
 * CLI shape shared by the single-token recovery/claim scripts.
 *
 * @param {readonly string[]} argv
 * @param {(message: string) => never} fail
 * @returns {Readonly<{ account: string, executeOne: boolean }>}
 */
export function parseAccountExecuteOneOptions(argv, fail) {
  const options = { account: "", executeOne: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const take = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail(`${argument} requires a value`);
      index += 1;
      return value;
    };
    if (argument === "--account") options.account = take().toLowerCase();
    else if (argument === "--execute-one") options.executeOne = true;
    else fail(`unknown argument ${argument}`);
  }
  if (!/^[a-z][a-z0-9.-]{2,15}$/.test(options.account)) fail("a canonical Hive --account is required");
  return Object.freeze(options);
}

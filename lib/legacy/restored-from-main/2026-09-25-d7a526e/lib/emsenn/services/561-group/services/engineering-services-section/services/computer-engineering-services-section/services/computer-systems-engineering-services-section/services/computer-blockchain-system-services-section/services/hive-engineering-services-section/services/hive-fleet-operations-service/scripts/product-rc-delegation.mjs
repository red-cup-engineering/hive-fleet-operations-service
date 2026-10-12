#!/usr/bin/env node
import { RpcClient } from "@red-cup-engineering/hive-blockchain-client-service/rpc.mjs";
// One exact, minimum-sized direct-RC allocation from the idle help-fund
// manabar to michael561's product-distribution lane. Read-only by default;
// execution requires the exact posting key and independently known prestate.

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  assertExactProductRcDelegation,
  planProductRcDelegation,
  PRODUCT_RC_DELEGATION,
  PRODUCT_RC_DELEGATOR,
  PRODUCT_RC_RECIPIENT,
  PRODUCT_RC_TARGET,
  productRcDelegationOperation,
} from "../src/core/directRcDelegation.mjs";
import { recordDirectRcDelegation } from "../src/core/directRcDelegationSettlement.mjs";
import { broadcastViaChildProcess } from "../src/core/hiveScriptSupport.mjs";
import { PrivateKey } from "@red-cup-engineering/hive-blockchain-client-service/keys.mjs";

const RPC_OPTIONS = Object.freeze({ timeout: 15000 });
const NODES = Object.freeze(["https://api.hive.blog", "https://api.openhive.network", "https://api.deathwing.me"]);
const BROADCASTER = new URL("./hive-broadcast.mjs", import.meta.url);
const DATA_DIR = new URL("../data/", import.meta.url).pathname;
function fail(message) { throw new Error(`product-rc-delegation: ${message}`); }
function digest(value) { return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`; }

export function parseOptions(argv) {
  const options = { account: "", keyFile: "", executeOne: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]; const take = () => { const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail(`${argument} requires a value`); index += 1; return value; };
    if (argument === "--account") options.account = take().toLowerCase();
    else if (argument === "--key-file") options.keyFile = take();
    else if (argument === "--execute-one") options.executeOne = true;
    else fail(`unknown argument ${argument}`);
  }
  if (options.account !== PRODUCT_RC_DELEGATOR) fail(`--account must be exactly ${PRODUCT_RC_DELEGATOR}`);
  if (options.executeOne && !options.keyFile) fail("--execute-one requires --key-file");
  if (!options.executeOne && options.keyFile) fail("--key-file is accepted only with --execute-one");
  return Object.freeze(options);
}



function amountUnits(asset, symbol) {
  const match = new RegExp(`^([0-9]+)\\.([0-9]{3}) ${symbol}$`, "u").exec(String(asset));
  if (!match) fail(`${symbol} asset is malformed`);
  return BigInt(`${match[1]}${match[2]}`);
}

function accountState(row, expected) {
  if (row?.account !== expected || !/^[1-9][0-9]*$/u.test(String(row.max_rc))
    || !/^[0-9]+$/u.test(String(row.rc_manabar?.current_mana)) || !Number.isSafeInteger(row.rc_manabar?.last_update_time)
    || !/^[0-9]+$/u.test(String(row.delegated_rc)) || !/^[0-9]+$/u.test(String(row.received_delegated_rc))) {
    fail(`malformed ${expected} RC state`);
  }
  return Object.freeze({ account: expected, maximumRc: String(row.max_rc), currentMana: String(row.rc_manabar.current_mana),
    updatedAt: Number(row.rc_manabar.last_update_time), delegatedRc: String(row.delegated_rc),
    receivedDelegatedRc: String(row.received_delegated_rc) });
}

async function observeNode(node) {
  try {
    const [accounts, stats, schedule, globals, outgoing] = await Promise.all([
      new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("rc_api.find_rc_accounts", { accounts: [PRODUCT_RC_DELEGATOR, PRODUCT_RC_RECIPIENT] }),
      new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("rc_api.get_rc_operation_stats", { operation: "custom_json_operation" }),
      new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("condenser_api.get_witness_schedule", []), new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("condenser_api.get_dynamic_global_properties", []),
      new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("condenser_api.list_rc_direct_delegations", [[PRODUCT_RC_DELEGATOR, ""], 100]),
    ]);
    if (!Array.isArray(accounts?.rc_accounts) || accounts.rc_accounts.length !== 2
      || !Number.isSafeInteger(stats?.avg_cost_rc) || stats.avg_cost_rc <= 0 || !Array.isArray(outgoing)) fail("RC carrier is malformed");
    const feeThird = amountUnits(schedule?.median_props?.account_creation_fee, "HIVE") / 3n;
    const fund = amountUnits(globals?.total_vesting_fund_hive, "HIVE");
    const vesting = (() => { const match = /^([0-9]+)\.([0-9]{6}) VESTS$/u.exec(String(globals?.total_vesting_shares));
      if (!match) fail("vesting share supply is malformed"); return BigInt(`${match[1]}${match[2]}`); })();
    const minimumDelegationRc = feeThird * vesting / fund;
    const donor = accountState(accounts.rc_accounts.find((row) => row.account === PRODUCT_RC_DELEGATOR), PRODUCT_RC_DELEGATOR);
    const recipient = accountState(accounts.rc_accounts.find((row) => row.account === PRODUCT_RC_RECIPIENT), PRODUCT_RC_RECIPIENT);
    const direct = outgoing.map((row) => Object.freeze({ from: String(row.from), to: String(row.to), delegated_rc: String(row.delegated_rc) }));
    if (direct.some((row) => row.from !== PRODUCT_RC_DELEGATOR || !/^[1-9][0-9]*$/u.test(row.delegated_rc))) fail("outgoing delegation carrier changed");
    const state = Object.freeze({ averageCustomJsonRc: String(stats.avg_cost_rc), donor, recipient, existingOutgoing: Object.freeze(direct) });
    return Object.freeze({ node, status: "available", state, stateDigest: digest(state), minimumDelegationRc: minimumDelegationRc.toString() });
  } catch (error) { return Object.freeze({ node, status: "unavailable", problem: error instanceof Error ? error.message : String(error) }); }
}

export async function observe() {
  const observedAt = new Date().toISOString(); const rows = await Promise.all(NODES.map(observeNode));
  const available = rows.filter((row) => row.status === "available"); const groups = new Map();
  for (const row of available) { const group = groups.get(row.stateDigest) ?? { state: row.state, rows: [] }; group.rows.push(row); groups.set(row.stateDigest, group); }
  if (available.length < 2 || groups.size !== 1) fail(groups.size > 1 ? "Hive providers contradict the direct-RC prestate" : "fewer than two Hive providers supplied direct-RC prestate");
  const [stateDigest, agreed] = [...groups.entries()][0];
  const plan = planProductRcDelegation({ observedAt, ...agreed.state,
    minimumDelegationRc: agreed.rows.map((row) => row.minimumDelegationRc) });
  return Object.freeze({ ...plan, evidence: Object.freeze({ knowledge: "true", stateDigest,
    providers: Object.freeze(agreed.rows.map((row) => row.node).sort()), minimumDelegationRc: Object.freeze(agreed.rows.map((row) => Object.freeze({
      provider: row.node, value: row.minimumDelegationRc }))) }) });
}

async function verifyPostingKey(keyFile) {
  const mode = statSync(keyFile).mode & 0o777; if ((mode & 0o077) !== 0) fail("posting-key file must not be group/world accessible");
  const publicKey = PrivateKey.from(readFileSync(keyFile, "utf8").trim()).createPublic("STM").toString();
  const accounts = await new RpcClient({ nodes: [NODES[0]], timeout: (RPC_OPTIONS).timeout }).call("condenser_api.get_accounts", [[PRODUCT_RC_DELEGATOR]]); const account = accounts?.[0];
  const threshold = Number(account?.posting?.weight_threshold ?? 1);
  const weight = Number((account?.posting?.key_auths ?? []).find(([candidate]) => candidate === publicKey)?.[1] ?? 0);
  if (weight < threshold) fail("the supplied key does not independently satisfy help-fund's posting authority");
}

function broadcast(request) { return broadcastViaChildProcess(request, BROADCASTER); }

export function exactDirectRcOperation(operation) {
  if (!Array.isArray(operation) || operation.length !== 2) return false;
  const name = operation[0]?.replace?.(/_operation$/u, "") ?? operation[0]; const fields = operation[1]?.value ?? operation[1];
  if (name !== "custom_json") return false;
  try { return assertExactProductRcDelegation({ account: PRODUCT_RC_DELEGATOR, role: "posting",
    lane: "product-rc-delegation", target: PRODUCT_RC_TARGET, fields }); } catch { return false; }
}

async function confirmTransaction(transactionId) {
  const confirmations = [];
  for (let attempt = 0; attempt < 12 && confirmations.length < 2; attempt += 1) {
    await Promise.all(NODES.map(async (node) => { if (confirmations.some((entry) => entry.node === node)) return;
      const transaction = await new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("account_history_api.get_transaction", { id: transactionId, include_reversible: true }).catch(() => null);
      const operation = transaction?.operations?.[0]; if (!operation) return;
      const normalized = operation?.type ? [operation.type, operation.value] : operation;
      if (!exactDirectRcOperation(normalized)) fail(`${node} confirmed a changed direct-RC operation`);
      confirmations.push(Object.freeze({ node, block: Number(transaction.block_num) })); }));
    if (confirmations.length < 2 && attempt < 11) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
  }
  if (confirmations.length < 2 || new Set(confirmations.map((entry) => entry.block)).size !== 1) fail("Hive providers did not agree on the direct-RC transaction");
  return Object.freeze(confirmations);
}

async function confirmDelegation() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const rows = await Promise.all(NODES.map(async (node) => { const values = await new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("condenser_api.list_rc_direct_delegations", [[PRODUCT_RC_DELEGATOR, PRODUCT_RC_RECIPIENT], 10]).catch(() => []);
      const exact = Array.isArray(values) && values.length === 1 && values[0]?.from === PRODUCT_RC_DELEGATOR
        && values[0]?.to === PRODUCT_RC_RECIPIENT && String(values[0]?.delegated_rc) === PRODUCT_RC_DELEGATION.toString();
      return Object.freeze({ node, exact }); }));
    const confirmed = rows.filter((row) => row.exact).map((row) => row.node).sort();
    if (confirmed.length >= 2) return Object.freeze(confirmed);
    if (attempt < 11) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
  }
  fail("fewer than two Hive providers exposed the exact direct-RC delegation");
}

export async function operate(options) {
  const plan = await observe(); const base = Object.freeze({ kind: "aagaard.direct-rc-delegation-receipt", account: options.account,
    plan, observedAt: new Date().toISOString() });
  if (!options.executeOne) return Object.freeze({ ...base, status: "observed", credentialAccess: false, chainMutation: false });
  if (plan.decision !== "delegate-one-exact-rc-allocation") return Object.freeze({ ...base, status: "delegation-refused", credentialAccess: false, chainMutation: false });
  await verifyPostingKey(options.keyFile); const operation = productRcDelegationOperation();
  const request = Object.freeze({ account: PRODUCT_RC_DELEGATOR, role: "posting", lane: "product-rc-delegation",
    target: PRODUCT_RC_TARGET, keyFile: options.keyFile, operation });
  let submitted;
  try { submitted = await broadcast(request); }
  catch (error) { throw new Error(`submission outcome unknown; do not retry automatically: ${error instanceof Error ? error.message : String(error)}`); }
  const transactionId = String(submitted?.id ?? "");
  if (!/^[0-9a-f]{40}$/u.test(transactionId)) fail("submission returned no canonical transaction id; do not retry automatically");
  const pending = Object.freeze({ ...base, status: "settlement-pending", transactionId, credentialAccess: true, chainMutation: true });
  let pendingRecord = null; try { pendingRecord = await recordDirectRcDelegation(DATA_DIR, pending); } catch { /* transaction id remains in receipt */ }
  let hive; let delegationProviders;
  try { hive = await confirmTransaction(transactionId); delegationProviders = await confirmDelegation(); }
  catch (error) { return Object.freeze({ ...pending, durableRecord: Object.freeze({ confirmed: pendingRecord !== null,
    eventId: pendingRecord?.eventId ?? null }), settlementProblem: error instanceof Error ? error.message : String(error), retryAllowed: false }); }
  const confirmed = Object.freeze({ ...base, status: "delegation-confirmed", transactionId, hive, delegationProviders,
    credentialAccess: true, chainMutation: true, retryAllowed: false });
  let durableRecord = null; try { durableRecord = await recordDirectRcDelegation(DATA_DIR, confirmed); } catch { /* return exact confirmed evidence */ }
  return Object.freeze({ ...confirmed, durableRecord: Object.freeze({ confirmed: durableRecord !== null, eventId: durableRecord?.eventId ?? null }) });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { process.stdout.write(`${JSON.stringify(await operate(parseOptions(process.argv.slice(2))), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}

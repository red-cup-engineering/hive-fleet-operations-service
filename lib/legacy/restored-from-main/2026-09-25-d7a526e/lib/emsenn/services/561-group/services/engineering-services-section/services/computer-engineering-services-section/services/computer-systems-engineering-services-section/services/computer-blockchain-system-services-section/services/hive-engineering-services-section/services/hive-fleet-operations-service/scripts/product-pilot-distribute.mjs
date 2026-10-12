#!/usr/bin/env node
import { RpcClient } from "@red-cup-engineering/hive-blockchain-client-service/rpc.mjs";
// One exact product-distribution act. The operator re-reads audience, prior
// reblog history, and RC before any key access; if ready it can broadcast only
// michael561's reblog of the reviewed offer, reconcile transaction and blog
// visibility through independent Hive providers, and append a zero-revenue
// distribution receipt.

import { readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  assertExactProductPilotReblog,
  PRODUCT_REBLOG_ACCOUNT,
  productPilotReblogOperation,
} from "../src/core/productDistribution.mjs";
import {
  recordProductPilotDistribution,
  readProductPilotEvents,
} from "../src/core/productPilotSettlement.mjs";
import { EXIT_TIGHTNESS_PILOT_TARGET } from "../src/core/exitTightnessPilotPost.mjs";
import { broadcastViaChildProcess } from "../src/core/hiveScriptSupport.mjs";
import { PrivateKey } from "@red-cup-engineering/hive-blockchain-client-service/keys.mjs";
import { observe as observeDistribution } from "./plan-product-pilot-distribution.mjs";

const RPC_OPTIONS = Object.freeze({ timeout: 12000 });
const HIVE_NODES = ["https://api.hive.blog", "https://api.openhive.network", "https://api.deathwing.me"];
const BROADCASTER = new URL("./hive-broadcast.mjs", import.meta.url);
const DATA_DIR = new URL("../data/", import.meta.url).pathname;

function fail(message) { throw new Error(`product-pilot-distribute: ${message}`); }

export function parseOptions(argv) {
  const options = { account: "", keyFile: "", executeOne: false, settleTx: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const take = () => { const value = argv[index + 1]; if (!value || value.startsWith("--")) fail(`${argument} requires a value`); index += 1; return value; };
    if (argument === "--account") options.account = take().toLowerCase();
    else if (argument === "--key-file") options.keyFile = take();
    else if (argument === "--execute-one") options.executeOne = true;
    else if (argument === "--settle-tx") options.settleTx = take().toLowerCase();
    else fail(`unknown argument ${argument}`);
  }
  if (options.account !== PRODUCT_REBLOG_ACCOUNT) fail(`--account must be exactly ${PRODUCT_REBLOG_ACCOUNT}`);
  if (options.executeOne && !options.keyFile) fail("--execute-one requires --key-file");
  if (options.settleTx && (options.executeOne || options.keyFile)) fail("--settle-tx cannot be combined with key access or execution");
  if (options.settleTx && !/^[0-9a-f]{40}$/u.test(options.settleTx)) fail("--settle-tx must be one canonical Hive transaction id");
  return Object.freeze(options);
}



async function verifyPostingKey(keyFile) {
  const mode = statSync(keyFile).mode & 0o777;
  if ((mode & 0o077) !== 0) fail("posting-key file must not be group/world accessible");
  const publicKey = PrivateKey.from(readFileSync(keyFile, "utf8").trim()).createPublic("STM").toString();
  const rows = await new RpcClient({ nodes: [HIVE_NODES[0]], timeout: (RPC_OPTIONS).timeout }).call("condenser_api.get_accounts", [[PRODUCT_REBLOG_ACCOUNT]]);
  const account = Array.isArray(rows) ? rows[0] : null;
  const threshold = Number(account?.posting?.weight_threshold ?? 1);
  const weight = Number((account?.posting?.key_auths ?? []).find(([candidate]) => candidate === publicKey)?.[1] ?? 0);
  if (weight < threshold) fail("the supplied key does not independently satisfy michael561's posting authority");
}

function broadcast(request) { return broadcastViaChildProcess(request, BROADCASTER); }

export function exactProductReblogOperation(operation) {
  const expected = productPilotReblogOperation();
  if (!Array.isArray(operation) || operation.length !== 2) return false;
  const name = operation[0]?.replace?.(/_operation$/u, "") ?? operation[0];
  const fields = operation[1]?.value ?? operation[1];
  if (name !== expected[0]) return false;
  try { return assertExactProductPilotReblog({ account: PRODUCT_REBLOG_ACCOUNT, role: "posting",
    lane: "product-distribution", target: EXIT_TIGHTNESS_PILOT_TARGET, fields }); } catch { return false; }
}

async function confirmTransaction(transactionId) {
  const confirmations = [];
  for (let attempt = 0; attempt < 12 && confirmations.length < 2; attempt += 1) {
    await Promise.all(HIVE_NODES.map(async (node) => {
      if (confirmations.some((entry) => entry.node === node)) return;
      const transaction = await new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("account_history_api.get_transaction", { id: transactionId, include_reversible: true }).catch(() => null);
      const operation = transaction?.operations?.[0];
      if (!operation) return;
      const normalized = operation?.type ? [operation.type, operation.value] : operation;
      if (!exactProductReblogOperation(normalized)) fail(`${node} confirmed a changed product reblog`);
      confirmations.push(Object.freeze({ node, block: Number(transaction.block_num) }));
    }));
    if (confirmations.length < 2 && attempt < 11) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
  }
  if (confirmations.length < 2 || new Set(confirmations.map((entry) => entry.block)).size !== 1) fail("Hive providers did not agree on the product reblog transaction");
  return Object.freeze(confirmations);
}

async function waitForVisibility() {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const rows = await Promise.all(HIVE_NODES.map(async (node) => {
      const entries = await new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("condenser_api.get_blog_entries", [PRODUCT_REBLOG_ACCOUNT, 0, 100]).catch(() => []);
      const visible = Array.isArray(entries) && entries.some((entry) => `${entry?.author}/${entry?.permlink}` === EXIT_TIGHTNESS_PILOT_TARGET
        && Number.isFinite(Date.parse(`${entry?.reblogged_on}Z`)) && Date.parse(`${entry?.reblogged_on}Z`) > 0);
      return Object.freeze({ node, visible });
    }));
    const visible = rows.filter((row) => row.visible);
    if (visible.length >= 2) return Object.freeze(visible.map((row) => row.node).sort());
    if (attempt < 15) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
  }
  fail("fewer than two Hive providers exposed the reblog in michael561's blog");
}

function audienceFromPlan(plan) {
  const candidate = plan.candidates?.find((entry) => entry.account === PRODUCT_REBLOG_ACCOUNT);
  if (!candidate || candidate.followers < 10 || !/^[1-9][0-9]*$/u.test(candidate.currentRc)
    || !/^[1-9][0-9]*$/u.test(candidate.requiredRc)) fail("fresh plan lacks exact michael561 audience or RC evidence");
  return Object.freeze({ followers: candidate.followers, observedAt: plan.observedAt,
    currentRc: candidate.currentRc, requiredRc: candidate.requiredRc });
}

async function settleExisting(transactionId) {
  const pending = readProductPilotEvents(DATA_DIR).find((event) => event.event === "offer-distribution"
    && event.transactionId === transactionId && event.status === "settlement-pending");
  if (!pending) fail("no durable pending product distribution matches --settle-tx");
  const hive = await confirmTransaction(transactionId);
  const visible = await waitForVisibility();
  const completedAt = new Date().toISOString();
  const confirmed = await recordProductPilotDistribution(DATA_DIR, { status: "distributed-confirmed", transactionId,
    block: hive[0].block, hiveProviders: hive.map((entry) => entry.node), ...pending.audience, recordedAt: completedAt });
  return Object.freeze({ kind: "aagaard.product-pilot-distribution-receipt", status: "distributed-confirmed",
    transactionId, hive, visible, durableRecord: Object.freeze({ confirmed: true, distributionId: confirmed.distributionId }),
    retryAllowed: false, credentialAccess: false, chainMutation: true, completedAt });
}

export async function operate(options) {
  if (options.settleTx) return settleExisting(options.settleTx);
  const plan = await observeDistribution();
  const base = Object.freeze({ kind: "aagaard.product-pilot-distribution-receipt", account: options.account,
    target: EXIT_TIGHTNESS_PILOT_TARGET, observedAt: new Date().toISOString(), plan });
  if (!options.executeOne) return Object.freeze({ ...base, status: "observed", credentialAccess: false, chainMutation: false });
  if (plan.decision !== "reblog-one-exact-product-offer" || plan.selectedAccount !== PRODUCT_REBLOG_ACCOUNT) {
    return Object.freeze({ ...base, status: plan.decision === "wait-for-rc-regeneration" ? "resource-credit-wait" : "distribution-refused",
      credentialAccess: false, chainMutation: false });
  }
  await verifyPostingKey(options.keyFile);
  const operation = productPilotReblogOperation();
  const request = Object.freeze({ account: PRODUCT_REBLOG_ACCOUNT, role: "posting", lane: "product-distribution",
    target: EXIT_TIGHTNESS_PILOT_TARGET, keyFile: options.keyFile, operation });
  let submitted;
  try { submitted = await broadcast(request); }
  catch (error) { throw new Error(`submission outcome unknown; do not retry automatically: ${error instanceof Error ? error.message : String(error)}`); }
  const transactionId = String(submitted?.id ?? "");
  if (!/^[0-9a-f]{40}$/u.test(transactionId)) fail("submission returned no canonical transaction id; do not retry automatically");
  const audience = audienceFromPlan(plan); const submittedAt = new Date().toISOString();
  let pendingRecord = null;
  try { pendingRecord = await recordProductPilotDistribution(DATA_DIR, { status: "settlement-pending", transactionId, ...audience, recordedAt: submittedAt }); } catch { /* receipt below preserves the transaction */ }
  let hive; let visible;
  try { hive = await confirmTransaction(transactionId); visible = await waitForVisibility(); }
  catch (error) { return Object.freeze({ ...base, status: "settlement-pending", transactionId,
    durableRecord: Object.freeze({ confirmed: pendingRecord !== null, distributionId: pendingRecord?.distributionId ?? null }),
    settlementProblem: error instanceof Error ? error.message : String(error), retryAllowed: false,
    credentialAccess: true, chainMutation: true, completedAt: new Date().toISOString() }); }
  const completedAt = new Date().toISOString();
  let durableRecord;
  try { const event = await recordProductPilotDistribution(DATA_DIR, { status: "distributed-confirmed", transactionId,
    block: hive[0].block, hiveProviders: hive.map((entry) => entry.node), ...audience, recordedAt: completedAt });
    durableRecord = Object.freeze({ confirmed: true, distributionId: event.distributionId }); }
  catch (error) { durableRecord = Object.freeze({ confirmed: false, error: error instanceof Error ? error.message : String(error) }); }
  return Object.freeze({ ...base, status: durableRecord.confirmed ? "distributed-confirmed" : "record-pending",
    transactionId, hive, visible, durableRecord, retryAllowed: false, revenueRecognized: "0.000 HBD",
    credentialAccess: true, chainMutation: true, completedAt });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { process.stdout.write(`${JSON.stringify(await operate(parseOptions(process.argv.slice(2))), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}

#!/usr/bin/env node
import { reportFailure } from "../src/commandFailure.mjs";
// One fixed-size HBD savings touch. The only executable operation is a
// 0.001 HBD self-deposit, used when an existing savings balance has passed
// Hive's interest compound interval. Exact balance and interest-operation
// evidence are independently reconciled before the receipt is recorded.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { recordHbdSavingsExit, recordHbdSavingsTouch } from "../src/core/hbdSavingsSettlement.mjs";
import { makeFail, parseAccountExecuteOneOptions, rpc as sharedRpc, providerMajority } from "../src/core/hiveScriptSupport.mjs";
import { submitToSigner } from "../src/core/signer.mjs";
import { HiveClient } from "@red-cup-engineering/hive-blockchain-client-service";
const hiveReader = new HiveClient();

const HIVE_NODES = ["https://api.hive.blog", "https://api.openhive.network", "https://api.deathwing.me"];
const DATA_DIR = new URL("../data/", import.meta.url).pathname;
const TOUCH_AMOUNT = "0.001 HBD";
const TOUCH_MEMO = "aagaard:hbd-interest-touch:v1";
const EXIT_MEMO = "aagaard:hbd-savings-exit:v1";
const COMPOUND_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

const fail = makeFail("hbd-savings-touch");
const rpc = (node, method, params, timeoutMs) => sharedRpc(node, method, params, { timeoutMs, backoffMs: 400, fail });

export function parseOptions(argv) { return parseAccountExecuteOneOptions(argv, fail); }

function hbdMilli(value) {
  const match = /^(0|[1-9][0-9]*)\.([0-9]{3}) HBD$/.exec(String(value));
  if (!match) fail(`noncanonical HBD amount '${value}'`);
  return BigInt(match[1]) * 1000n + BigInt(match[2]);
}

function formatHbd(milli) {
  if (milli < 0n) fail("negative HBD amount");
  return `${milli / 1000n}.${(milli % 1000n).toString().padStart(3, "0")} HBD`;
}

function accountEvidence(row) {
  if (!row || typeof row !== "object") fail("Hive account evidence is absent");
  hbdMilli(row.hbd_balance);
  hbdMilli(row.savings_hbd_balance);
  const lastPayment = String(row.savings_hbd_last_interest_payment ?? "");
  if (!Number.isFinite(Date.parse(`${lastPayment}Z`))) fail("savings interest timestamp is malformed");
  return Object.freeze({
    account: String(row.name ?? ""),
    liquidHbd: String(row.hbd_balance),
    savingsHbd: String(row.savings_hbd_balance),
    lastInterestPayment: `${lastPayment}.000Z`,
  });
}

const majority = (rows) => providerMajority(rows, fail, "the account evidence");

async function readState(account) {
  const rows = await Promise.all(HIVE_NODES.map(async (node) => {
    const [accounts, props] = await Promise.all([
      rpc(node, "condenser_api.get_accounts", [[account]]),
      rpc(node, "condenser_api.get_dynamic_global_properties", []),
    ]);
    const value = Object.freeze({ ...accountEvidence(accounts?.[0]), hbdInterestRateBps: Number(props?.hbd_interest_rate) });
    if (!Number.isInteger(value.hbdInterestRateBps) || value.hbdInterestRateBps < 0 || value.hbdInterestRateBps > 10_000) {
      fail(`${node} returned an invalid HBD interest rate`);
    }
    return Object.freeze({ node, value });
  }));
  return majority(rows);
}

export function planTouch(state, nowMs = Date.now()) {
  const elapsedMs = nowMs - Date.parse(state.lastInterestPayment);
  if (hbdMilli(state.savingsHbd) <= 0n) return Object.freeze({ kind: "refuse", reason: "account has no HBD savings balance" });
  if (hbdMilli(state.liquidHbd) < 1n) return Object.freeze({ kind: "refuse", reason: "account lacks the fixed 0.001 HBD touch amount" });
  if (!Number.isFinite(elapsedMs) || elapsedMs <= COMPOUND_INTERVAL_MS) {
    return Object.freeze({ kind: "refuse", reason: "the HBD savings compound interval has not elapsed" });
  }
  if (state.hbdInterestRateBps <= 0) return Object.freeze({ kind: "refuse", reason: "the current HBD interest rate is not positive" });
  return Object.freeze({
    kind: "touch",
    amount: TOUCH_AMOUNT,
    memo: TOUCH_MEMO,
    elapsedDays: Number((elapsedMs / 86_400_000).toFixed(3)),
    hbdInterestRateBps: state.hbdInterestRateBps,
    reason: "touch an interest-bearing HBD savings balance after the compound interval with the minimum token unit",
  });
}

function normalizeWithdrawal(row) {
  if (!row || typeof row !== "object") return null;
  return Object.freeze({ from: String(row.from ?? ""), to: String(row.to ?? ""), requestId: Number(row.request_id),
    amount: String(row.amount ?? ""), memo: String(row.memo ?? ""), complete: String(row.complete ?? "") });
}

async function waitForWithdrawal(account, before, operation) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const rows = await Promise.all(HIVE_NODES.map(async (node) => {
      const [accounts, requests] = await Promise.all([
        rpc(node, "condenser_api.get_accounts", [[account]]),
        rpc(node, "condenser_api.get_savings_withdraw_from", [account]),
      ]);
      const state = accountEvidence(accounts?.[0]);
      const request = (Array.isArray(requests) ? requests : []).map(normalizeWithdrawal).find((row) => row?.requestId === operation[1].request_id) ?? null;
      return Object.freeze({ node, value: Object.freeze({ state, request }) });
    }));
    const agreed = majority(rows);
    const request = agreed.value.request;
    if (agreed.value.state.savingsHbd === "0.000 HBD" && agreed.value.state.liquidHbd === before.liquidHbd
      && request?.from === account && request.to === account && request.amount === operation[1].amount
      && request.memo === operation[1].memo && Number.isFinite(Date.parse(`${request.complete}Z`))) return agreed;
    if (attempt < 29) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
  }
  return null;
}

function interestFromHistory(result, account, minimumBlock) {
  if (!Array.isArray(result)) return null;
  for (const entry of [...result].reverse()) {
    const row = entry?.[1];
    const op = row?.op;
    if (!Array.isArray(op) || op[0] !== "interest" || Number(row?.block) < minimumBlock) continue;
    const fields = op[1];
    if (fields?.owner !== account || fields?.is_saved_into_hbd_balance !== false) continue;
    const amount = String(fields?.interest ?? "");
    if (hbdMilli(amount) <= 0n) continue;
    return Object.freeze({ nodeBlock: Number(row.block), amount, historyIndex: Number(entry[0]), timestamp: String(row.timestamp ?? "") });
  }
  return null;
}

async function waitForEffect(account, before, transactionBlock) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const [state, historyRows] = await Promise.all([
      readState(account),
      Promise.all(HIVE_NODES.map(async (node) => Object.freeze({
        node,
        interest: interestFromHistory(await rpc(node, "condenser_api.get_account_history", [account, -1, 100]), account, transactionBlock),
      }))),
    ]);
    const liquidDelta = hbdMilli(before.liquidHbd) - hbdMilli(state.value.liquidHbd);
    const savingsDelta = hbdMilli(state.value.savingsHbd) - hbdMilli(before.savingsHbd);
    const realizedInterest = savingsDelta - 1n;
    const matching = historyRows.filter((row) => row.interest?.amount === formatHbd(realizedInterest));
    if (liquidDelta === 1n && savingsDelta > 1n
      && Date.parse(state.value.lastInterestPayment) > Date.parse(before.lastInterestPayment)
      && matching.length >= 2) {
      return Object.freeze({ state, realizedInterest: formatHbd(realizedInterest), interestProviders: Object.freeze(matching) });
    }
    if (attempt < 29) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
  }
  fail("the savings balance and interest virtual operation did not independently reconcile before timeout");
}

export async function operate(options) {
  if (options.executeOne) {
  }
  const before = await readState(options.account);
  const plan = planTouch(before.value);
  const base = Object.freeze({
    kind: "aagaard.hbd-savings-interest-touch-receipt",
    account: options.account,
    observedAt: new Date().toISOString(),
    before: before.value,
    evidenceProviders: before.providers,
    plan,
  });
  if (!options.executeOne) return Object.freeze({ ...base, status: "observed" });
  if (plan.kind !== "touch") fail(`fresh plan is not executable: ${plan.reason}`);
  const operation = Object.freeze(["transfer_to_savings", Object.freeze({
    from: options.account, to: options.account, amount: plan.amount, memo: plan.memo,
  })]);
  let result;
  try {
    result = await submitToSigner({ account: options.account, role: "active", lane: "savings", target: options.account, operation });
  } catch (error) {
    throw new Error(`submission outcome unknown; do not retry automatically: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof result?.id !== "string" || !/^[0-9a-f]{40}$/.test(result.id)) fail("submission returned no canonical transaction id; do not retry automatically");
  const hive = await hiveReader.confirmTransaction(result.id, operation);
  const effect = await waitForEffect(options.account, before.value, hive[0].block);
  const receipt = Object.freeze({
    ...base,
    status: "interest-confirmed",
    transactionId: result.id,
    hive,
    deposited: plan.amount,
    realizedInterest: effect.realizedInterest,
    after: effect.state.value,
    stateProviders: effect.state.providers,
    interestProviders: effect.interestProviders,
    completedAt: new Date().toISOString(),
  });
  const event = await recordHbdSavingsTouch(DATA_DIR, receipt, receipt.completedAt);
  const requestId = hive[0].block;
  const exitOperation = Object.freeze(["transfer_from_savings", Object.freeze({ from: options.account, request_id: requestId,
    to: options.account, amount: effect.state.value.savingsHbd, memo: EXIT_MEMO })]);
  let exitSubmission;
  try { exitSubmission = await submitToSigner({ account: options.account, role: "active", lane: "savings-exit", target: options.account,
    operation: exitOperation }); }
  catch (error) { throw new Error(`interest touch confirmed as ${result.id}, but savings-exit submission outcome is unknown; do not retry automatically: ${error instanceof Error ? error.message : String(error)}`); }
  if (!/^[0-9a-f]{40}$/.test(String(exitSubmission?.id ?? ""))) fail("savings-exit submission returned no canonical transaction id; do not retry automatically");
  const exitTransactionId = String(exitSubmission.id);
  let exitHive = null; let withdrawal = null; let exitError = null;
  try { exitHive = await hiveReader.hiveReader.confirmTransaction(exitTransactionId, exitOperation);
    withdrawal = await waitForWithdrawal(options.account, effect.state.value, exitOperation);
    if (!withdrawal) exitError = "withdrawal request did not independently reconcile before timeout"; }
  catch (error) { exitError = error instanceof Error ? error.message : String(error); }
  const exitCompletedAt = new Date().toISOString();
  const exitReceipt = Object.freeze({ kind: "aagaard.hbd-savings-exit-receipt", account: options.account,
    transactionId: exitTransactionId, status: withdrawal ? "withdrawal-queued" : "settlement-pending", retryAllowed: false,
    requestId, amount: exitOperation[1].amount, touchTransactionId: result.id, ...(exitHive ? { hive: exitHive } : {}),
    ...(withdrawal ? { withdrawal } : {}), ...(exitError ? { settlementError: exitError } : {}), completedAt: exitCompletedAt });
  const exitEvent = await recordHbdSavingsExit(DATA_DIR, exitReceipt, exitCompletedAt);
  return Object.freeze({ ...receipt, durableRecord: Object.freeze({ confirmed: true, eventId: event.eventId }),
    exit: Object.freeze({ ...exitReceipt, durableRecord: Object.freeze({ confirmed: true, eventId: exitEvent.eventId }) }) });
}

async function main() { process.stdout.write(`${JSON.stringify(await operate(parseOptions(process.argv.slice(2))))}\n`); }

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(reportFailure);
}

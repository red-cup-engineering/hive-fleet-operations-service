#!/usr/bin/env node
import { reportFailure } from "../src/commandFailure.mjs";
// Start one full-balance Hive-Engine unstake after independently proving the
// token's cooldown and that no delegation or earlier unstake encumbers it.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { TOKEN_UNLOCK_CATEGORY, tokenUnlockEvent } from "../src/core/tokenUnlockSettlement.mjs";
import { FLEET_DATA_DIR, witnessChainAct } from "../src/core/journal.mjs";
import { makeFail, engineFind, engineTransaction } from "../src/core/hiveScriptSupport.mjs";
import { engineCustomJson, tokens } from "@red-cup-engineering/hive-blockchain-client-service/engine.mjs";
import { decimalUnits, formatUnits } from "@red-cup-engineering/exact-number-data-service/decimal-string";
import { submitToSigner } from "../src/core/signer.mjs";
import { HiveClient } from "@red-cup-engineering/hive-blockchain-client-service";
const hiveReader = new HiveClient();

const CONTRACT_NODES = ["https://api.hive-engine.com/rpc/contracts", "https://herpc.dtools.dev/contracts"];
const BLOCKCHAIN_NODES = ["https://api.hive-engine.com/rpc/blockchain", "https://herpc.dtools.dev/blockchain"];

const fail = makeFail("unstake-token");

export function parseOptions(argv) {
  const options = { account: "", symbol: "", executeOne: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const take = () => { const value = argv[index + 1]; if (!value || value.startsWith("--")) fail(`${argument} requires a value`); index += 1; return value; };
    if (argument === "--account") options.account = take().toLowerCase();
    else if (argument === "--symbol") options.symbol = take().toUpperCase();
    else if (argument === "--execute-one") options.executeOne = true;
    else fail(`unknown argument ${argument}`);
  }
  if (!/^[a-z][a-z0-9.-]{2,15}$/.test(options.account)) fail("a canonical Hive --account is required");
  if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(options.symbol) || options.symbol === "SWAP.HIVE") fail("a stakable --symbol is required");
  return Object.freeze(options);
}

const find = (node, contract, table, query, limit = 1000, indexes = []) => engineFind(node, contract, table, query, { limit, indexes, backoffMs: 350, fail });



async function readState(account, symbol, node) {
  const [tokens, balances, pending] = await Promise.all([
    find(node, "tokens", "tokens", { symbol }, 2), find(node, "tokens", "balances", { account, symbol }, 2),
    find(node, "tokens", "pendingUnstakes", { account, symbol }, 1000),
  ]);
  if (tokens.length !== 1 || balances.length !== 1) fail(`${node} returned non-unique token or balance evidence`);
  const token = tokens[0]; const balance = balances[0]; const precision = Number(token.precision);
  if (!Number.isInteger(precision) || precision < 0 || precision > 8) fail(`${node} returned invalid precision`);
  const canonical = (value) => formatUnits(decimalUnits(String(value ?? "0"), precision), precision);
  return Object.freeze({ account, symbol, precision, stakingEnabled: token.stakingEnabled === true,
    unstakingCooldownDays: Number(token.unstakingCooldown), numberTransactions: Number(token.numberTransactions),
    liquid: canonical(balance.balance), stake: canonical(balance.stake), pendingUnstake: canonical(balance.pendingUnstake),
    delegationsOut: canonical(balance.delegationsOut), pendingUndelegations: canonical(balance.pendingUndelegations),
    pendingRows: Object.freeze(pending.map((row) => Object.freeze({ txID: String(row.txID), quantity: canonical(row.quantity),
      quantityLeft: canonical(row.quantityLeft), nextTransactionTimestamp: Number(row.nextTransactionTimestamp),
      numberTransactionsLeft: Number(row.numberTransactionsLeft) })).sort((a, b) => a.txID.localeCompare(b.txID))) });
}

const ECONOMIC_FIELDS = ["account", "symbol", "precision", "stakingEnabled", "unstakingCooldownDays", "numberTransactions", "liquid", "stake", "pendingUnstake", "delegationsOut", "pendingUndelegations", "pendingRows"];
export function statesAgree(left, right) { return ECONOMIC_FIELDS.every((field) => JSON.stringify(left[field]) === JSON.stringify(right[field])); }

export function planUnstake(state) {
  const stake = decimalUnits(state.stake, state.precision);
  if (!state.stakingEnabled) return Object.freeze({ kind: "refuse", reason: "token staking is not enabled" });
  if (stake === 0n) return Object.freeze({ kind: "refuse", reason: "no staked balance remains" });
  if (decimalUnits(state.pendingUnstake, state.precision) !== 0n || state.pendingRows.length !== 0) return Object.freeze({ kind: "refuse", reason: "an unstake is already pending" });
  if (decimalUnits(state.delegationsOut, state.precision) !== 0n || decimalUnits(state.pendingUndelegations, state.precision) !== 0n) return Object.freeze({ kind: "refuse", reason: "delegated stake must return before unstaking" });
  if (!Number.isInteger(state.unstakingCooldownDays) || state.unstakingCooldownDays < 1
    || !Number.isInteger(state.numberTransactions) || state.numberTransactions < 1) return Object.freeze({ kind: "refuse", reason: "token unstake schedule is malformed" });
  const quantity = formatUnits(stake, state.precision);
  return Object.freeze({ kind: "unstake", quantity, cooldownDays: state.unstakingCooldownDays,
    numberTransactions: state.numberTransactions,
    firstReleaseUnits: formatUnits(stake / BigInt(state.numberTransactions), state.precision),
    operation: engineCustomJson(state.account, tokens.unstake({ symbol: state.symbol, quantity })) });
}

async function independentlyObservedState(account, symbol) {
  const states = await Promise.all(CONTRACT_NODES.map((node) => readState(account, symbol, node)));
  if (!statesAgree(states[0], states[1])) fail("independent Hive-Engine providers disagree on unstake evidence");
  return Object.freeze({ state: states[0], providers: Object.freeze(CONTRACT_NODES.map((node) => Object.freeze({ node }))) });
}

const engineTx = (node, txid) => engineTransaction(node, txid, { backoffMs: 350, fail });

async function waitForEffect(account, symbol, txid, before, plan) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const [transactions, states] = await Promise.all([
      Promise.all(BLOCKCHAIN_NODES.map((node) => engineTx(node, txid))),
      Promise.all(CONTRACT_NODES.map((node) => readState(account, symbol, node))),
    ]);
    const quantity = decimalUnits(plan.quantity, before.precision); const first = quantity / BigInt(before.numberTransactions);
    const confirmed = transactions.every(Boolean) && states.every((state) =>
      decimalUnits(state.pendingUnstake, before.precision) - decimalUnits(before.pendingUnstake, before.precision) === quantity
      && decimalUnits(before.stake, before.precision) - decimalUnits(state.stake, before.precision) === first
      && state.pendingRows.some((row) => row.txID === txid && decimalUnits(row.quantity, before.precision) === quantity));
    if (confirmed) return Object.freeze({ transactions, states });
    if (attempt < 19) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1200));
  }
  return null;
}

export async function operate(options) {
  const observed = await independentlyObservedState(options.account, options.symbol); const plan = planUnstake(observed.state);
  const base = Object.freeze({ kind: "aagaard.token-unstake-receipt", account: options.account, symbol: options.symbol,
    observedAt: new Date().toISOString(), before: observed.state, evidenceProviders: observed.providers, plan });
  if (!options.executeOne) return Object.freeze({ ...base, status: "observed" });
  if (plan.kind !== "unstake") fail(`fresh plan is not executable: ${plan.reason}`);
  const target = `unstake:${options.symbol}:${plan.quantity}`; let submission;
  try { submission = await submitToSigner({ account: options.account, role: "active", lane: "liquidity-unlock", target, operation: plan.operation }); }
  catch (error) { throw new Error(`submission outcome unknown; do not retry automatically: ${error instanceof Error ? error.message : String(error)}`); }
  if (!/^[0-9a-f]{40}$/.test(String(submission?.id ?? ""))) fail("submission returned no canonical transaction id; do not retry automatically");
  const transactionId = String(submission.id); let hive = null; let effect = null; let settlementError = null;
  try { hive = await hiveReader.confirmTransaction(transactionId, plan.operation); effect = await waitForEffect(options.account, options.symbol, transactionId, observed.state, plan);
    if (!effect) settlementError = "unstake effect did not independently reconcile before timeout"; }
  catch (error) { settlementError = error instanceof Error ? error.message : String(error); }
  const completedAt = new Date().toISOString(); const receipt = Object.freeze({ ...base, transactionId, ...(hive ? { hive } : {}),
    status: effect ? "unstake-start-confirmed" : "settlement-pending", retryAllowed: false,
    ...(settlementError ? { settlementError } : {}), ...(effect ? { engine: effect.transactions, after: effect.states } : {}), completedAt });
  const event = witnessChainAct(FLEET_DATA_DIR, TOKEN_UNLOCK_CATEGORY, completedAt, tokenUnlockEvent(receipt, completedAt));
  return Object.freeze({ ...receipt, durableRecord: Object.freeze({ confirmed: true, eventId: event.eventId }) });
}

async function main() { process.stdout.write(`${JSON.stringify(await operate(parseOptions(process.argv.slice(2))))}\n`); }
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(reportFailure);

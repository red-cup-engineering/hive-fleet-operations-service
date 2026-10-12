#!/usr/bin/env node
import { FLEET_DATA_DIR } from "../src/core/journal.mjs";
import { reportFailure } from "../src/commandFailure.mjs";
// One-action TerraCore operator. It claims a material raid-exposed stash
// first; otherwise it may spend one regenerated attack against one freshly
// revalidated conservative target. The boundary accepts only a posting key
// and contains no upgrade, stake, token transfer, crate, quest, boss, NFT,
// marketplace, or repeated-battle capability.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { selectTerraCoreBattleTarget } from "@red-cup-engineering/terracore-services-section";
import { parseTerraCoreBattleTargets } from "@red-cup-engineering/terracore-services-section";
import { terraCoreBattleTargetFromPlayer } from "@red-cup-engineering/terracore-services-section";
import { parseTerraCorePlayer } from "@red-cup-engineering/terracore-services-section";
import { planTerraCoreActions } from "@red-cup-engineering/terracore-services-section";
import {
  readTerraCoreActionReceipts,
  recordTerraCoreActionReceipt,
} from "../src/core/terracoreSettlement.mjs";
import { makeFail, rpc as sharedRpc } from "../src/core/hiveScriptSupport.mjs";
import { observeRcReserve } from "../src/integrations/hive/rcReserve.adapter.mjs";
import { decimalUnits, formatUnits } from "@red-cup-engineering/computer-data-engineering-services-section/number/decimal-string";
import { submitToSigner } from "../src/core/signer.mjs";
import { HiveClient } from "@red-cup-engineering/hive-blockchain-client-service";
import { FLEET_ACCOUNTS } from "../src/core/core.adapter.mjs";
const hiveReader = new HiveClient();

const API = "https://api.terracoregame.com";
const HIVE_NODES = ["https://api.hive.blog", "https://api.openhive.network", "https://api.deathwing.me"];
const ENGINE_NODES = ["https://api.hive-engine.com/rpc/contracts", "https://herpc.dtools.dev/contracts"];
const FLEET = FLEET_ACCOUNTS;
const DATA_DIR = FLEET_DATA_DIR;

const fail = makeFail("terracore-cycle");
const rpc = (node, method, params, timeoutMs) => sharedRpc(node, method, params, { timeoutMs, backoffMs: 500, fail });

export function parseOptions(argv) {
  const options = { account: "", executeOne: false, recoverTx: "" };
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
    else if (argument === "--recover-tx") options.recoverTx = take().toLowerCase();
    else fail(`unknown argument ${argument}`);
  }
  if (!/^[a-z][a-z0-9.-]{2,15}$/.test(options.account)) fail("a canonical Hive --account is required");
  if (options.recoverTx && !/^[0-9a-f]{40}$/.test(options.recoverTx)) fail("--recover-tx must be a canonical Hive transaction id");
  if (options.recoverTx && options.executeOne) fail("--recover-tx cannot be combined with execution");
  return Object.freeze(options);
}

function gameScrapFloorUnits8(value) {
  const match = /^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value);
  if (!match) fail(`noncanonical in-game SCRAP amount '${value}'`);
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 100_000_000n + BigInt((fraction + "00000000").slice(0, 8));
}

async function getText(path, timeoutMs = 8_000) {
  let residue = "unavailable";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${API}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
      const text = await response.text();
      if (response.ok) return text;
      residue = `HTTP ${response.status}`;
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) { residue = error instanceof Error ? error.message : String(error); }
    if (attempt < 2) await new Promise((resolvePromise) => setTimeout(resolvePromise, 500 * (attempt + 1)));
  }
  fail(`${path} failed: ${residue}`);
}

async function readPlayer(account) {
  return parseTerraCorePlayer(await getText(`/player/${encodeURIComponent(account)}`), new Date().toISOString());
}

async function readTargets(maxDefense) {
  const observedAt = new Date().toISOString();
  const body = await getText(`/battle?limit=500&offset=1&maxDefense=${encodeURIComponent(String(Math.max(0, Math.floor(maxDefense))))}`);
  return parseTerraCoreBattleTargets(body, observedAt);
}

async function readScrapBalance(account, node) {
  const rows = await rpc(node, "find", { contract: "tokens", table: "balances", query: { account, symbol: "SCRAP" }, limit: 2, offset: 0, indexes: [] });
  if (!Array.isArray(rows) || rows.length > 1) fail(`${node} returned malformed SCRAP balance evidence`);
  const balance = String(rows[0]?.balance ?? "0.00000000");
  decimalUnits(balance, 8);
  return Object.freeze({ node, balance: formatUnits(decimalUnits(balance, 8), 8), observedAt: new Date().toISOString() });
}

export function balancesAgree(left, right) { return left.balance === right.balance; }

async function independentlyReadBalance(account) {
  const balances = await Promise.all(ENGINE_NODES.map((node) => readScrapBalance(account, node)));
  if (!balancesAgree(balances[0], balances[1])) fail("independent Hive-Engine providers disagree on the SCRAP balance");
  return Object.freeze({ balance: balances[0].balance, providers: Object.freeze(balances) });
}

async function hiveAccount(account) {
  for (const node of HIVE_NODES) {
    const rows = await rpc(node, "condenser_api.get_accounts", [[account]]).catch(() => null);
    if (Array.isArray(rows) && rows[0]) return rows[0];
  }
  fail(`Hive account ${account} was not found on any admitted provider`);
}

function playerSafe(player) {
  return Object.freeze({
    observedAt: player.observedAt,
    scrap: player.scrap,
    mineRate: player.mineRate,
    health: player.health,
    damage: player.effectiveDamage,
    defense: player.effectiveDefense,
    dodge: player.effectiveDodge,
    crit: player.effectiveCrit,
    protection: player.effectiveProtection,
    attacks: player.attacks,
    maxAttacks: player.maxAttacks,
    lastClaimMs: player.lastClaimMs ?? null,
    lastBattleMs: player.lastBattleMs ?? null,
  });
}

async function selectPlan(player) {
  const base = planTerraCoreActions(player);
  const claim = base.actions[0];
  if (claim) return Object.freeze({ kind: "claim", reason: claim.reason, amount: claim.amount, operation: claim.operation });
  const snapshot = await readTargets(player.effectiveDamage * 2 / 3);
  const battle = selectTerraCoreBattleTarget(player, snapshot, FLEET, new Date());
  if (battle.kind === "refuse") return battle;
  return Object.freeze({ kind: "battle", reason: battle.reason, target: battle.target, operation: battle.operation });
}

async function revalidateBattle(player, plan) {
  const targetPlayer = await readPlayer(plan.target.account);
  const target = terraCoreBattleTargetFromPlayer(targetPlayer);
  const snapshot = Object.freeze({ observedAt: target.observedAt, targets: Object.freeze([target]) });
  const selected = selectTerraCoreBattleTarget(player, snapshot, FLEET, new Date());
  if (selected.kind !== "battle" || selected.target.account !== plan.target.account) {
    fail(`fresh target ${plan.target.account} no longer satisfies the conservative battle policy`);
  }
  return Object.freeze({ ...plan, target: selected.target, operation: selected.operation });
}

async function readBattleLogs(account) {
  let rows;
  try { rows = JSON.parse(await getText(`/battle_logs/${encodeURIComponent(account)}`)); } catch { fail("battle log response is not JSON"); }
  if (!Array.isArray(rows)) fail("battle log response is not an array");
  return rows;
}

export function findNewBattleLog(rows, priorIds, actor, target, earliestMs) {
  const prior = new Set(priorIds);
  const match = rows.find((row) => !prior.has(String(row?._id ?? ""))
    && row?.username === actor && row?.attacked === target
    && Number.isSafeInteger(Number(row?.timestamp)) && Number(row.timestamp) >= earliestMs);
  if (!match) return null;
  const reported = String(match.scrap ?? "");
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(reported)) fail("battle log SCRAP result is malformed");
  const [whole = "0", fraction = ""] = reported.split(".");
  return Object.freeze({
    id: String(match._id),
    actor,
    target,
    timestamp: Number(match.timestamp),
    apiReportedScrap: `${whole}.${(fraction + "00000000").slice(0, 8)}`,
    dodged: match.dodged === true,
    reason: typeof match.reason === "string" ? match.reason : null,
    roll: typeof match.roll === "number" && Number.isFinite(match.roll) ? match.roll : null,
  });
}

async function waitForBattleEffect(account, target, priorIds, earliestMs) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const [rows, player] = await Promise.all([readBattleLogs(account), readPlayer(account)]);
    const log = findNewBattleLog(rows, priorIds, account, target, earliestMs);
    if (log && player.attacks === 0) return Object.freeze({ log, player });
    if (attempt < 14) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
  }
  fail("TerraCore did not expose a bound battle log and spent attack after the confirmed transaction");
}

export function reconcileClaimBalances(beforeBalance, afterBalance, claimedAmount, beforeScrap, afterScrap) {
  try {
    const received = decimalUnits(afterBalance, 8) - decimalUnits(beforeBalance, 8);
    return Object.freeze({
      confirmed: received >= decimalUnits(claimedAmount, 8) && gameScrapFloorUnits8(afterScrap) < gameScrapFloorUnits8(beforeScrap),
      received: received < 0n ? "0.00000000" : formatUnits(received, 8),
    });
  } catch {
    return Object.freeze({ confirmed: false, received: "0.00000000" });
  }
}

async function waitForClaimEffect(account, beforePlayer, beforeBalance, amount) {
  for (let attempt = 0; attempt < 75; attempt += 1) {
    const [player, balance] = await Promise.all([readPlayer(account), independentlyReadBalance(account)]);
    const reconciliation = reconcileClaimBalances(beforeBalance, balance.balance, amount, beforePlayer.scrap, player.scrap);
    if (reconciliation.confirmed) return Object.freeze({ player, balance, reconciliation });
    if (attempt < 74) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
  }
  fail("TerraCore claim was not independently confirmed by stash and wallet effects");
}

async function durablyRecord(receipt) {
  try {
    const event = await recordTerraCoreActionReceipt(DATA_DIR, receipt, receipt.completedAt ?? new Date().toISOString());
    return Object.freeze({ ...receipt, durableRecord: Object.freeze({ confirmed: true, eventId: event.eventId }) });
  } catch (error) {
    return Object.freeze({
      ...receipt,
      durableRecord: Object.freeze({ confirmed: false, error: error instanceof Error ? error.message : String(error) }),
    });
  }
}

function claimRecoveryEvidence(event, account, transactionId) {
  const receipt = event?.receipt;
  const plan = receipt?.plan;
  const before = receipt?.before;
  const beforePlayer = before?.player;
  if (event?.account !== account || event?.transactionId !== transactionId || event?.status !== "settlement-pending"
    || receipt?.status !== "settlement-pending" || plan?.kind !== "claim"
    || typeof plan?.amount !== "string" || typeof before?.liquidScrap !== "string"
    || typeof beforePlayer?.scrap !== "string") {
    fail("the durable pending receipt does not carry a recoverable claim baseline");
  }
  decimalUnits(plan.amount, 8);
  decimalUnits(before.liquidScrap, 8);
  gameScrapFloorUnits8(beforePlayer.scrap);
  return Object.freeze({ receipt, plan, before, beforePlayer });
}

async function recoverClaim(account, transactionId) {
  const events = await readTerraCoreActionReceipts(DATA_DIR, transactionId);
  const pending = [...events].reverse().find((event) => event.status === "settlement-pending");
  if (!pending) fail("no durable settlement-pending TerraCore receipt exists for that transaction");
  const evidence = claimRecoveryEvidence(pending, account, transactionId);
  const operation = Object.freeze(["custom_json", Object.freeze({
    required_auths: Object.freeze([]),
    required_posting_auths: Object.freeze([account]),
    id: "terracore_claim",
    json: JSON.stringify({ amount: evidence.plan.amount }),
  })]);
  const hive = await hiveReader.confirmTransaction(transactionId, operation);
  const effect = await waitForClaimEffect(account, evidence.beforePlayer, evidence.before.liquidScrap, evidence.plan.amount);
  const { settlement: _settlement, completedAt: _priorCompletedAt, durableRecord: _priorDurableRecord, ...base } = evidence.receipt;
  return durablyRecord(Object.freeze({
    ...base,
    status: "claim-confirmed",
    transactionId,
    hive,
    claimedScrap: effect.reconciliation.received,
    after: Object.freeze({ player: playerSafe(effect.player), liquidScrap: effect.balance.balance }),
    recoveryOf: pending.eventId,
    completedAt: new Date().toISOString(),
  }));
}

export function settlementPendingReceipt(base, transactionId, hive, error, completedAt = new Date().toISOString()) {
  return Object.freeze({
    ...base,
    status: "settlement-pending",
    transactionId,
    hive,
    settlement: Object.freeze({
      confirmed: false,
      retryAllowed: false,
      reason: `the Hive transaction is confirmed but the game effect was not independently reconciled before timeout: ${error instanceof Error ? error.message : String(error)}`,
    }),
    completedAt,
  });
}

function safePlan(plan) {
  if (plan.kind === "claim") return Object.freeze({ kind: "claim", amount: plan.amount, reason: plan.reason });
  if (plan.kind === "battle") return Object.freeze({ kind: "battle", target: plan.target, reason: plan.reason });
  return plan;
}

export async function operate(options) {
  if (options.recoverTx) return recoverClaim(options.account, options.recoverTx);
  const [player, balance, resourceCredits] = await Promise.all([
    readPlayer(options.account),
    independentlyReadBalance(options.account),
    observeRcReserve({ account: options.account, operation: "custom_json_operation" }),
  ]);
  let plan = await selectPlan(player);
  const base = Object.freeze({
    kind: "aagaard.terracore-one-action-receipt",
    account: options.account,
    observedAt: new Date().toISOString(),
    before: Object.freeze({ player: playerSafe(player), liquidScrap: balance.balance }),
    plan: safePlan(plan),
    providers: balance.providers.map(({ node, observedAt }) => Object.freeze({ node, observedAt })),
    resourceCredits,
  });
  if (!options.executeOne) return Object.freeze({ ...base, status: "observed" });
  // No admitted action this tick (no regenerated attack, nothing to claim) is a receipt, not a failure.
  if (plan.kind === "refuse") return Object.freeze({ ...base, status: "waiting", credentialAccess: false, chainMutation: false });
  if (resourceCredits.status !== "certified") return Object.freeze({ ...base, status: "resource-credit-uncertain", credentialAccess: false, chainMutation: false });
  if (resourceCredits.plan.decision !== "ready") return Object.freeze({ ...base, status: "resource-credit-wait", credentialAccess: false, chainMutation: false });
  let priorIds = [];
  if (plan.kind === "battle") {
    plan = await revalidateBattle(player, plan);
    priorIds = (await readBattleLogs(options.account)).map((row) => String(row?._id ?? ""));
  }
  const submittedAfterMs = Date.now() - 5_000;
  let result;
  try {
    result = await submitToSigner({
      account: options.account,
      role: "posting",
      lane: "gaming",
      target: "terracore-one-action",
      operation: plan.operation,
    });
  } catch (error) {
    throw new Error(`submission outcome unknown; do not retry automatically: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof result?.id !== "string" || !/^[0-9a-f]{40}$/.test(result.id)) fail("submission returned no canonical transaction id; do not retry automatically");
  const hive = await hiveReader.confirmTransaction(result.id, plan.operation);
  if (plan.kind === "claim") {
    let effect;
    try {
      effect = await waitForClaimEffect(options.account, player, balance.balance, plan.amount);
    } catch (error) {
      return durablyRecord(settlementPendingReceipt(base, result.id, hive, error));
    }
    return durablyRecord(Object.freeze({
      ...base,
      status: "claim-confirmed",
      transactionId: result.id,
      hive,
      claimedScrap: effect.reconciliation.received,
      after: Object.freeze({ player: playerSafe(effect.player), liquidScrap: effect.balance.balance }),
      completedAt: new Date().toISOString(),
    }));
  }
  let effect;
  try {
    effect = await waitForBattleEffect(options.account, plan.target.account, priorIds, submittedAfterMs);
  } catch (error) {
    return durablyRecord(settlementPendingReceipt(base, result.id, hive, error));
  }
  return durablyRecord(Object.freeze({
    ...base,
    status: decimalUnits(effect.log.apiReportedScrap, 8) > 0n
      ? "battle-won-confirmed"
      : effect.log.dodged ? "battle-dodged-confirmed" : "battle-settled-no-scrap",
    transactionId: result.id,
    hive,
    target: plan.target,
    battleLog: effect.log,
    after: Object.freeze({ player: playerSafe(effect.player) }),
    completedAt: new Date().toISOString(),
  }));
}

async function main() { process.stdout.write(`${JSON.stringify(await operate(parseOptions(process.argv.slice(2))))}\n`); }

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(reportFailure);
}

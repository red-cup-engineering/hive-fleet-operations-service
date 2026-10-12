#!/usr/bin/env node
import { RpcClient } from "@red-cup-engineering/hive-blockchain-client-service/rpc.mjs";
import { reportFailure } from "../src/commandFailure.mjs";
// Observe or execute one exact five-card Modern roster acquisition. The
// purchase spends only existing Splinterlands CREDITS, never DEC/HIVE/SPS,
// and is re-derived from live official listings at both this boundary and
// the lower signing boundary immediately before broadcast.

import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  SPLINTERLANDS_ROSTER_PURCHASE_POLICY,
  planSplinterlandsRosterPurchase,
  reconcileSplinterlandsRosterPurchase,
} from "@red-cup-engineering/splinterlands-services-section/market";
import { SPLINTERLANDS_OPERATOR_POLICY, assessOwnedModernCoverage } from "../src/integrations/splinterlands/splinterlandsOperator.mjs";
import { submitToSigner } from "../src/core/signer.mjs";
import { HiveClient } from "@red-cup-engineering/hive-blockchain-client-service";
import { accountPolicy } from "../src/core/accountStrategy.mjs";
const POLICY_FLEET = accountPolicy("").fleet;
const hiveReader = new HiveClient();

const RPC_OPTIONS = Object.freeze({ timeout: 8000 });
const API = "https://api.splinterlands.com";
const HIVE_NODES = ["https://api.hive.blog", "https://api.openhive.network", "https://api.deathwing.me"];

function fail(message) { throw new Error(`splinterlands-roster-purchase: ${message}`); }

export function parseOptions(argv) {
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
  if (options.account !== SPLINTERLANDS_OPERATOR_POLICY.account) fail(`--account must be the account whose strategy config runs splinterlands (${SPLINTERLANDS_OPERATOR_POLICY.account || "none configured"})`);
  return Object.freeze(options);
}

async function readJson(path) {
  const response = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) fail(`${path} returned HTTP ${response.status}`);
  return response.json();
}



async function hiveAccount(account) {
  for (const node of HIVE_NODES) {
    const rows = await new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("condenser_api.get_accounts", [[account]]).catch(() => null);
    if (Array.isArray(rows) && rows[0]) return rows[0];
  }
  fail(`Hive account ${account} was not found on any admitted provider`);
}


function creditsFrom(balances, account) {
  if (!Array.isArray(balances)) fail("Splinterlands returned malformed balance evidence");
  const balance = Number(balances.find((row) => row?.player === account && row?.token === "CREDITS")?.balance);
  if (!Number.isSafeInteger(balance) || balance < 0) fail("Splinterlands returned a malformed CREDITS balance");
  return balance;
}

async function observe(account) {
  const [settings, player, balances, collection, details, rules, ...listingGroups] = await Promise.all([
    readJson("/settings"),
    readJson(`/players/details?name=${encodeURIComponent(account)}`),
    readJson(`/players/balances?username=${encodeURIComponent(account)}`),
    readJson(`/cards/collection/${encodeURIComponent(account)}`),
    readJson("/cards/get_details"),
    readJson("/battle/rulesets"),
    ...SPLINTERLANDS_ROSTER_PURCHASE_POLICY.cards.map((card) => readJson(`/market/for_sale_by_card?card_detail_id=${card.cardDetailId}&gold=false&edition=${card.edition}`)),
  ]);
  if (collection?.player !== account || !Array.isArray(collection?.cards)) fail("collection response disagrees with the requested account");
  const listingsByCard = new Map(SPLINTERLANDS_ROSTER_PURCHASE_POLICY.cards.map((card, index) => [card.cardDetailId, listingGroups[index]]));
  const plan = planSplinterlandsRosterPurchase({
    account,
    creditBalance: creditsFrom(balances, account),
    clientVersion: String(settings?.version ?? ""),
    nonce: randomBytes(5).toString("hex"),
    listingsByCard,
    fleet: [...POLICY_FLEET],
  });
  return Object.freeze({ settings, player, balances, collection, details, rules, plan });
}

function safePlan(plan) {
  return Object.freeze({
    credits: plan.credits,
    creditReserve: plan.creditReserve,
    listings: Object.freeze(plan.listings.map((row) => Object.freeze({
      cardDetailId: row.cardDetailId,
      edition: row.edition,
      uid: row.uid,
      marketId: row.marketId,
      seller: row.seller,
      usdPrice: row.usdPrice,
    }))),
  });
}

async function waitForSettlement(before) {
  let latestReason = "official state has not settled";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const [balances, collection] = await Promise.all([
        readJson(`/players/balances?username=${encodeURIComponent(before.plan.account)}`),
        readJson(`/cards/collection/${encodeURIComponent(before.plan.account)}`),
      ]);
      const settlement = reconcileSplinterlandsRosterPurchase({
        plan: before.plan,
        beforeCredits: creditsFrom(before.balances, before.plan.account),
        afterCredits: creditsFrom(balances, before.plan.account),
        beforeUids: before.collection.cards.map((card) => String(card.uid)),
        afterUids: collection.cards.map((card) => String(card.uid)),
      });
      return Object.freeze({ settlement, balances, collection });
    } catch (error) { latestReason = error instanceof Error ? error.message : String(error); }
    if (attempt < 19) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
  }
  fail(`purchase did not reconcile: ${latestReason}`);
}

export async function run(options) {
  const before = await observe(options.account);
  if (!options.executeOne) return Object.freeze({
    kind: "aagaard.splinterlands-roster-purchase",
    mode: "observe-only",
    account: options.account,
    observedAt: new Date().toISOString(),
    plan: safePlan(before.plan),
    submitted: false,
  });
  const submission = await submitToSigner({
    account: options.account,
    role: "active",
    lane: SPLINTERLANDS_ROSTER_PURCHASE_POLICY.lane,
    target: SPLINTERLANDS_ROSTER_PURCHASE_POLICY.target,
    operation: before.plan.operation,
  });
  const confirmations = await hiveReader.confirmTransaction(submission.id, before.plan.operation);
  const after = await waitForSettlement(before);
  const coverageInput = {
    account: options.account,
    owned: after.collection.cards,
    details: before.details,
    modernEditions: before.settings.modern_editions,
    ruleCatalog: before.rules,
    rankedLeague: Number(before.player?.modern_league ?? 0),
    manaCap: 8,
  };
  const coverageNow = assessOwnedModernCoverage(coverageInput);
  const coverageAfterTransferCooldown = assessOwnedModernCoverage({ ...coverageInput, now: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000 + 60_000) });
  if (!coverageAfterTransferCooldown.readyForUnattendedQueue) fail("settled roster does not prove complete post-cooldown coverage");
  return Object.freeze({
    kind: "aagaard.splinterlands-roster-purchase",
    mode: "executed-one",
    account: options.account,
    transactionId: submission.id,
    confirmations,
    plan: safePlan(before.plan),
    settlement: after.settlement,
    coverageNow: Object.freeze({ ready: coverageNow.readyForUnattendedQueue, gaps: coverageNow.unplayableCombinedScenarios.length }),
    coverageAfterTransferCooldown: Object.freeze({ ready: true, scenarios: coverageAfterTransferCooldown.combinedScenariosTested, manaCap: 8 }),
  });
}

async function main() { process.stdout.write(`${JSON.stringify(await run(parseOptions(process.argv.slice(2))))}\n`); }

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(reportFailure);
}

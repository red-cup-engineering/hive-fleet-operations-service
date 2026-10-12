#!/usr/bin/env node
import { engineFind, oneRow } from "../src/core/hiveScriptSupport.mjs";
import { reportFailure } from "../src/commandFailure.mjs";
// Read-only recovery observer for assets left by HashKings. This boundary has
// no key input, transaction builder, planting, purchase, transfer, or listing
// capability. It only admits a future recovery review from executable demand
// or independently confirmed recent sales.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assessHashKingsRecovery } from "@red-cup-engineering/hashkings-services-section";
import { hashKingsFormatUnits } from "@red-cup-engineering/hashkings-services-section";
import { hashKingsDecimalUnits } from "@red-cup-engineering/hashkings-services-section";
import { quoteHashKingsBudsPoolExit } from "@red-cup-engineering/hashkings-services-section";
import { classifyDomainResponse } from "@red-cup-engineering/hashkings-services-section";

const ENGINE_NODES = ["https://api.hive-engine.com/rpc/contracts", "https://herpc.dtools.dev/contracts"];
const SYMBOLS = Object.freeze(["BUDS", "HKWATER", "MOTA"]);

function fail(message) { throw new Error(`hashkings-recovery: ${message}`); }

export function parseOptions(argv) {
  const options = { account: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== "--account") fail(`unknown argument ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail("--account requires a value");
    options.account = value.toLowerCase();
    index += 1;
  }
  if (!/^[a-z][a-z0-9.-]{2,15}$/.test(options.account)) fail("a canonical Hive --account is required");
  return Object.freeze(options);
}

// One node, retried with backoff, refusing through this script's fail.

const find = (node, contract, table, query, limit = 1000, indexes = []) => engineFind(node, contract, table, query, { limit, indexes, fail });

const oneOrNone = (rows, field) => oneRow(rows, field, fail, { required: false });

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}

async function readState(account, node) {
  // Public contract nodes often return gateway HTML under a request burst.
  // Keep one in-flight read per provider; the two sovereign providers still
  // run concurrently and must reconcile exactly before a receipt is emitted.
  const tokenRows = [];
  const balanceRows = [];
  for (const symbol of SYMBOLS) tokenRows.push(await find(node, "tokens", "tokens", { symbol }, 2));
  for (const symbol of SYMBOLS) balanceRows.push(await find(node, "tokens", "balances", { account, symbol }, 2));
  const nfts = await find(node, "nft", "HKFARMinstances", { account, ownedBy: "u" }, 1000);
  const ownListings = await find(node, "nftmarket", "HKFARMsellBook", { account, ownedBy: "u" }, 1000);
  const trades = await find(node, "nftmarket", "HKFARMtradesHistory", {}, 1000);
  const budsBids = await find(node, "market", "buyBook", { symbol: "BUDS" }, 1000);
  const waterBids = await find(node, "market", "buyBook", { symbol: "HKWATER" }, 1000);
  const motaBids = await find(node, "market", "buyBook", { symbol: "MOTA" }, 1000);
  const pools = await find(node, "marketpools", "pools", { tokenPair: "BUDS:SWAP.HIVE" }, 2);
  const precisions = Object.fromEntries(SYMBOLS.map((symbol, index) => {
    const token = oneOrNone(tokenRows[index], `${symbol} token`);
    if (!token) fail(`${symbol} token does not exist`);
    return [symbol, Number(token.precision)];
  }));
  const fungibles = SYMBOLS.map((symbol, index) => {
    const precision = precisions[symbol];
    const row = oneOrNone(balanceRows[index], `${symbol} balance`);
    const units = row ? hashKingsDecimalUnits(String(row.balance), precision) : 0n;
    return Object.freeze({ symbol, balance: hashKingsFormatUnits(units, precision), precision });
  });
  const normalizedNfts = nfts.map((row) => Object.freeze({
    id: Number(row._id),
    type: String(row.properties?.TYPE ?? ""),
    name: String(row.properties?.NAME ?? ""),
    properties: stable(row.properties ?? {}),
  })).sort((left, right) => left.id - right.id);
  const buds = fungibles.find((asset) => asset.symbol === "BUDS");
  const pool = oneOrNone(pools, "BUDS/SWAP.HIVE pool");
  const budsPoolExitSwapHive = pool && buds
    ? quoteHashKingsBudsPoolExit(buds.balance, String(pool.baseQuantity), String(pool.quoteQuantity))
    : null;
  const timestamps = trades.map((row) => Number(row.timestamp)).filter((value) => Number.isSafeInteger(value) && value > 0);
  return Object.freeze({
    account,
    observedAt: new Date().toISOString(),
    fungibles: Object.freeze(fungibles),
    nfts: Object.freeze(normalizedNfts),
    actualBuyOrderCounts: Object.freeze({ BUDS: budsBids.length, HKWATER: waterBids.length, MOTA: motaBids.length }),
    budsPoolExitSwapHive,
    ownNftListingCount: ownListings.length,
    latestNftTradeUnix: timestamps.length > 0 ? Math.max(...timestamps) : null,
  });
}

const ECONOMIC_FIELDS = ["account", "fungibles", "nfts", "actualBuyOrderCounts", "budsPoolExitSwapHive", "ownNftListingCount", "latestNftTradeUnix"];

export function statesAgree(left, right) {
  return ECONOMIC_FIELDS.every((field) => JSON.stringify(left[field]) === JSON.stringify(right[field]));
}

async function inspectDomain() {
  try {
    const response = await fetch("https://hashkings.app", { redirect: "manual", signal: AbortSignal.timeout(8_000) });
    const location = response.headers.get("location") ?? "";
    const body = await response.text();
    return classifyDomainResponse(response.status, location, body.slice(0, 4096));
  } catch {
    return "unknown";
  }
}

function safeState(state) {
  return Object.freeze({
    observedAt: state.observedAt,
    fungibles: state.fungibles,
    hkfarmNfts: Object.freeze({
      count: state.nfts.length,
      byType: Object.freeze(Object.fromEntries([...new Set(state.nfts.map((asset) => asset.type))].sort().map((type) => [type, state.nfts.filter((asset) => asset.type === type).length]))),
      assets: Object.freeze(state.nfts.map(({ id, type, name }) => Object.freeze({ id, type, name }))),
      disposition: "preserved-in-wallet",
    }),
    market: Object.freeze({
      actualBuyOrderCounts: state.actualBuyOrderCounts,
      budsPoolExitSwapHive: state.budsPoolExitSwapHive,
      ownNftListingCount: state.ownNftListingCount,
      latestNftTradeUnix: state.latestNftTradeUnix,
      latestNftTradeAt: state.latestNftTradeUnix === null ? null : new Date(state.latestNftTradeUnix * 1000).toISOString(),
    }),
  });
}

export async function operate(options) {
  const [states, domainDisposition] = await Promise.all([
    Promise.all(ENGINE_NODES.map((node) => readState(options.account, node))),
    inspectDomain(),
  ]);
  const providersAgree = statesAgree(states[0], states[1]);
  const evidence = Object.freeze({
    ...states[0],
    providersAgree,
    domainDisposition,
    nfts: Object.freeze(states[0].nfts.map(({ id, type, name }) => Object.freeze({ id, type, name }))),
  });
  const assessment = assessHashKingsRecovery(evidence);
  if (!providersAgree) fail("independent Hive-Engine providers disagree on HashKings recovery evidence");
  return Object.freeze({
    kind: "aagaard.hashkings-recovery-observation",
    status: "observed-no-action",
    account: options.account,
    observedAt: new Date().toISOString(),
    domainDisposition,
    state: safeState(states[0]),
    assessment,
    providers: Object.freeze(states.map((state, index) => Object.freeze({ node: ENGINE_NODES[index], observedAt: state.observedAt }))),
    authority: Object.freeze({ keyAccepted: false, transactionCapability: false }),
  });
}

async function main() { process.stdout.write(`${JSON.stringify(await operate(parseOptions(process.argv.slice(2))))}\n`); }

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(reportFailure);
}

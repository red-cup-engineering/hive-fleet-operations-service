#!/usr/bin/env node
// Read-only fleet market scan. It reuses Aagaard's exact pool-to-book bundle
// sizer and fleet self-cross guard but supplies no writer, key, or live lane.
// A candidate remains counterfactual until independently re-observed and
// admitted through the separate execution boundary.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createHiveEngineClient, loadAagaardConfig, planTrades } from "../src/index.mjs";

function fail(message) { throw new Error(`market-shadow-scan: ${message}`); }

export function parseOptions(argv) {
  const options = { account: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag !== "--account") fail(`unknown argument ${flag}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail("--account requires a value");
    options.account = value.toLowerCase(); index += 1;
  }
  if (options.account && !/^[a-z][a-z0-9.-]{2,15}$/.test(options.account)) fail("--account must be a canonical Hive account name");
  return Object.freeze(options);
}

function shadowState(wallet, market) {
  return Object.freeze({ account: wallet.account, hive: "0.000 HIVE", hbd: "0.000 HBD",
    currentMana: "0", maxMana: "0", tokens: market.tokens });
}

function compactBundle(bundle) {
  return Object.freeze({ id: bundle.id, kind: bundle.kind, symbol: bundle.symbol, pool: bundle.pool,
    quantity: bundle.quantity, maximumInputSwapHive: bundle.maxInputSwapHive,
    minimumProceedsSwapHive: bundle.minimumProceedsSwapHive,
    worstCaseProfitSwapHive: bundle.worstCaseProfitSwapHive, edgeBps: bundle.edgeBps,
    executable: bundle.executable, funded: bundle.funded, refusalReason: bundle.refusalReason,
    selfCrossAdmitted: bundle.selfCrossGuard?.admitted ?? null });
}

export async function scan(options, dependencies = {}) {
  const config = dependencies.config ?? loadAagaardConfig({ configPath: resolve("aagaard.config.json") });
  const marketBoundary = dependencies.market ?? createHiveEngineClient(config.hiveEngine);
  const wallets = config.wallets.filter((wallet) => !options.account || wallet.account === options.account);
  if (wallets.length === 0) fail("requested account is not in the Aagaard fleet");
  const observedAt = new Date().toISOString();
  const makerScan = marketBoundary.readFleetOpenOrders
    ? await marketBoundary.readFleetOpenOrders(config.wallets.map((wallet) => wallet.account), observedAt)
    : null;
  const accounts = [];
  for (const wallet of wallets) {
    const market = await marketBoundary.readWalletMarket(wallet);
    if (!market) {
      accounts.push(Object.freeze({ account: wallet.account, status: "market-unavailable", tradingLive: wallet.tradingLive,
        swapHiveBalance: null, corridors: Object.freeze([]), bundles: Object.freeze([]), arbitrageCycles: Object.freeze([]) }));
      continue;
    }
    const plan = planTrades(wallet, observedAt, shadowState(wallet, market), market, null, {}, false, makerScan ?? undefined);
    accounts.push(Object.freeze({
      account: wallet.account,
      status: "observed",
      tradingLive: wallet.tradingLive,
      swapHiveBalance: market.tokens["SWAP.HIVE"] ?? "0",
      availability: market.availability ?? null,
      corridors: plan.liquidity.corridors,
      bundles: Object.freeze(plan.bundles.map(compactBundle)),
      arbitrageCycles: plan.arbitrageCycles,
      allocation: plan.allocation,
    }));
  }
  const executable = accounts.flatMap((account) => account.bundles.filter((bundle) => bundle.executable)
    .map((bundle) => Object.freeze({ account: account.account, ...bundle })));
  return Object.freeze({
    kind: "aagaard.market-shadow-scan",
    observedAt,
    mode: "read-only-counterfactual",
    providerConsensusClaim: false,
    makerOrderScan: makerScan ? Object.freeze({ complete: makerScan.complete, observedAt: makerScan.observedAt,
      accountsRequested: makerScan.accountsRequested, accountsObserved: makerScan.accountsObserved,
      orderCount: makerScan.orders.length, limitations: makerScan.limitations }) : null,
    accounts: Object.freeze(accounts),
    executableCandidates: Object.freeze(executable),
    candidateCount: executable.length,
    chainMutation: false,
    credentialAccess: false,
    interpretationLimits: Object.freeze([
      "one-provider-failover-read-is-not-independent-provider-consensus",
      "candidate-is-not-an-order-or-profit-until-freshly-reobserved-broadcast-and-settled",
      "all-costs-and-proceeds-remain-in-SWAP.HIVE-with-no-native-HIVE-HBD-or-USD-equivalence",
    ]),
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { process.stdout.write(`${JSON.stringify(await scan(parseOptions(process.argv.slice(2))), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}


#!/usr/bin/env node
// Native HIVE/HBD cycle. Dry-run is the default. A live acquisition is
// fill-or-kill; its maker exit is broadcast only after a fresh chain read
// observes both the acquired balance and disappearance of the buy order.

import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { hiveWriteRequest } from "../src/integrations/hive/hiveWrite.adapter.mjs";
import { submitToSigner } from "../src/core/signer.mjs";
import { createHiveClient } from "../src/integrations/hive/hive.adapter.mjs";
import { planNativeMarketCycle } from "../src/core/nativeMarket.mjs";

function fail(message) { throw new Error(`native-market-cycle: ${message}`); }

export function parseOptions(argv) {
  const options = { account: "", live: false, cancelAll: false, watchSeconds: 0, windowMinutes: 5 };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--live") { options.live = true; continue; }
    if (flag === "--cancel-all") { options.cancelAll = true; continue; }
    if (!["--account", "--watch-seconds", "--window-minutes"].includes(flag)) fail(`unknown argument ${flag}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${flag} requires a value`);
    if (flag === "--account") options.account = value.toLowerCase();
    else if (flag === "--watch-seconds") options.watchSeconds = Number(value);
    else options.windowMinutes = Number(value);
    index += 1;
  }
  if (!/^[a-z][a-z0-9.-]{2,15}$/.test(options.account)) fail("--account is required and must be canonical");
  if (!Number.isInteger(options.watchSeconds) || options.watchSeconds < 0 || options.watchSeconds > 3600) fail("--watch-seconds must be an integer from 0 through 3600");
  if (!Number.isInteger(options.windowMinutes) || options.windowMinutes < 1 || options.windowMinutes > 60) fail("--window-minutes must be an integer from 1 through 60");
  if (options.cancelAll && !options.live) fail("--cancel-all requires --live");
  return Object.freeze(options);
}

function assetAmount(value) {
  const match = /^(0|[1-9][0-9]*)\.([0-9]{3}) (?:HIVE|HBD)$/.exec(value);
  return match ? BigInt(`${match[1]}${match[2]}`) : null;
}

async function observeFilled(client, account, buy, beforeHive, attempts = 10) {
  const wanted = assetAmount(`${buy.quantityHive} HIVE`);
  if (beforeHive === null || wanted === null) return null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const observation = await client.readNativeMarket(account, 5);
    const afterHive = assetAmount(observation.hiveBalance);
    const orderStillOpen = observation.openOrders.some((order) => order.orderId === buy.orderId);
    if (observation.complete && !orderStillOpen && afterHive !== null && afterHive - beforeHive >= wanted) return observation;
    if (attempt < attempts - 1) await new Promise((resolveDelay) => setTimeout(resolveDelay, 3000));
  }
  return null;
}

export async function cycle(options, dependencies = {}) {
  const rawConfig = dependencies.config ?? JSON.parse(readFileSync("aagaard.config.json", "utf8"));
  const hiveConfig = rawConfig.hive;
  const accountConfig = rawConfig.accounts.find((entry) => entry.account === options.account);
  const wallet = accountConfig ? Object.freeze({ account: accountConfig.account }) : null;
  if (!wallet) fail("account is not in the Aagaard fleet");
  const client = dependencies.client ?? createHiveClient(hiveConfig);
  const sign = dependencies.sign ?? submitToSigner;
  const observation = await client.readNativeMarket(wallet.account, options.windowMinutes);
  if (options.cancelAll) {
    const cancellations = [];
    for (const order of observation.openOrders) cancellations.push(await sign(hiveWriteRequest.nativeCancelOrder(wallet, order.orderId)));
    return Object.freeze({ kind: "aagaard.native-market-cycle", mode: "live-cancel", observation, cancellations: Object.freeze(cancellations), chainMutation: cancellations.length > 0 });
  }
  const plan = planNativeMarketCycle(observation);
  if (!options.live || !plan.admitted || !plan.buy || !plan.contingentSell) {
    return Object.freeze({ kind: "aagaard.native-market-cycle", mode: options.live ? "live-refused" : "dry-run", observation, plan, receipts: Object.freeze([]), chainMutation: false });
  }
  const beforeHive = assetAmount(observation.hiveBalance);
  const acquisition = await sign(hiveWriteRequest.nativeLimitOrder(wallet, plan.buy));
  const fillEvidence = await observeFilled(client, wallet.account, plan.buy, beforeHive);
  if (!fillEvidence) return Object.freeze({ kind: "aagaard.native-market-cycle", mode: "live-acquisition-unresolved", observation, plan, receipts: Object.freeze([acquisition]), chainMutation: true, contingentSellBroadcast: false });
  const exit = await sign(hiveWriteRequest.nativeLimitOrder(wallet, plan.contingentSell));
  return Object.freeze({ kind: "aagaard.native-market-cycle", mode: "live", observation, fillEvidence, plan, receipts: Object.freeze([acquisition, exit]), chainMutation: true, contingentSellBroadcast: true });
}

export async function run(options, dependencies = {}) {
  const rows = [];
  do {
    rows.push(await cycle(options, dependencies));
    if (options.watchSeconds > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, options.watchSeconds * 1000));
  } while (options.watchSeconds > 0);
  return Object.freeze(rows);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { process.stdout.write(`${JSON.stringify(await run(parseOptions(process.argv.slice(2))), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}

#!/usr/bin/env node
import { engineFind } from "../src/core/hiveScriptSupport.mjs";
// Read-only product probe: independently observe one public Hive Engine token
// position and calculate the gross executable bid-depth value of a named liquid
// quantity. It never reads a key, signs, broadcasts, or treats SWAP.HIVE as HIVE.

import { pathToFileURL } from "node:url";

import { certifyHiveEngineExit } from "../src/core/exitTightness.mjs";
import { decimalUnits, formatUnits } from "@red-cup-engineering/exact-number-data-service/decimal-string";
import { liveEngineBook } from "@red-cup-engineering/hive-blockchain-client-service/market.mjs";

const NODES = ["https://api.hive-engine.com/rpc/contracts", "https://herpc.dtools.dev/contracts"];
const BOOK_LIMIT = 1000;

function fail(message) { throw new Error(`hive-engine-exit-tightness: ${message}`); }

export function parseOptions(argv) {
  const options = { account: "", symbol: "", quantity: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const take = () => { const value = argv[index + 1]; if (!value || value.startsWith("--")) fail(`${flag} requires a value`); index += 1; return value; };
    if (flag === "--account") options.account = take().toLowerCase();
    else if (flag === "--symbol") options.symbol = take().toUpperCase();
    else if (flag === "--quantity") options.quantity = take();
    else fail(`unknown argument ${flag}`);
  }
  if (!/^[a-z][a-z0-9.-]{2,15}$/.test(options.account)) fail("--account must be a canonical Hive account name");
  if (!/^[A-Z0-9.]{1,20}$/.test(options.symbol) || options.symbol === "SWAP.HIVE") fail("--symbol must be a Hive Engine token other than SWAP.HIVE");
  if (options.quantity && !/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(options.quantity)) fail("--quantity must be a canonical nonnegative decimal");
  return Object.freeze(options);
}

const find = (node, contract, table, query, limit = BOOK_LIMIT, indexes = []) => engineFind(node, contract, table, query, { limit, indexes, timeoutMs: 10000, fail });



async function observe(node, account, symbol) {
  const observedAt = new Date().toISOString();
  try {
    const [tokens, balances, rawBids] = await Promise.all([
      find(node, "tokens", "tokens", { symbol }, 2),
      find(node, "tokens", "balances", { account, symbol }, 2),
      find(node, "market", "buyBook", { symbol }, BOOK_LIMIT, [{ index: "priceDec", descending: true }]),
    ]);
    if (tokens.length !== 1 || balances.length !== 1) fail(`${node} did not return one token and one balance row`);
    const token = tokens[0]; const balance = balances[0]; const precision = Number(token.precision);
    if (!Number.isInteger(precision) || precision < 0 || precision > 12) fail(`${node} returned an invalid token precision`);
    const amount = (value) => formatUnits(decimalUnits(value ?? "0", precision), precision);
    const now = Math.floor(Date.parse(observedAt) / 1000);
    const bids = liveEngineBook(rawBids, precision, "bid", now).map(({ price, quantity, orderId }) => Object.freeze({ price, quantity, orderId }));
    return Object.freeze({ provider: node, observedAt, status: "available", state: Object.freeze({
      symbol, precision, liquid: amount(balance.balance), stake: amount(balance.stake), delegationsOut: amount(balance.delegationsOut),
      pendingUnstake: amount(balance.pendingUnstake), pendingUndelegations: amount(balance.pendingUndelegations),
      stakingEnabled: token.stakingEnabled === true, delegationEnabled: token.delegationEnabled === true,
      unstakingCooldownDays: token.stakingEnabled === true ? Number(token.unstakingCooldown) : null,
      undelegationCooldownDays: token.delegationEnabled === true ? Number(token.undelegationCooldown) : null,
      releaseTransactions: token.stakingEnabled === true ? Number(token.numberTransactions) : null,
      bidBookComplete: rawBids.length < BOOK_LIMIT, bids: Object.freeze(bids),
    }) });
  } catch (error) {
    return Object.freeze({ provider: node, observedAt, status: "unavailable", problem: error instanceof Error ? error.message : String(error) });
  }
}

export async function makeReport(options) {
  const observations = await Promise.all(NODES.map((node) => observe(node, options.account, options.symbol)));
  const available = observations.find((entry) => entry.status === "available");
  const requestedQuantity = options.quantity || available?.state?.liquid || "0";
  return certifyHiveEngineExit({ account: options.account, requestedQuantity, observations });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { process.stdout.write(`${JSON.stringify(await makeReport(parseOptions(process.argv.slice(2))), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}


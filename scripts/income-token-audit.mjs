#!/usr/bin/env node
import { RpcClient } from "@red-cup-engineering/hive-blockchain-client-service/rpc.mjs";
// Read-only by default: reconcile native-HIVE distributions from one admitted
// income token across independent Hive witnesses, then attach (but never
// commingle) the token's independently certified SWAP.HIVE exit sidecar.

import { pathToFileURL } from "node:url";

import {
  incomeTokenDistributionFromHistoryRow,
  recordIncomeTokenDistributions,
  summarizeIncomeTokenPosition,
} from "../src/core/incomeTokenSettlement.mjs";
import { attestProviders } from "../src/core/providerAttestation.mjs";
import { makeReport as makeExitReport } from "./hive-engine-exit-tightness.mjs";

const HIVE_NODES = Object.freeze([
  "https://api.hive.blog",
  "https://api.openhive.network",
  "https://api.deathwing.me",
]);
// Each admitted symbol is bound to its one independently observed native-HIVE
// payer.  Keeping this map closed prevents an arbitrary transfer memo from
// being promoted into income evidence merely because it names a held token.
const SUPPORTED = Object.freeze({ EDSI: "eds-pay", SPI: "spi-payments", BRO: "brodivs" });
const HISTORY_LIMIT = 1_000;
const DATA_DIR = new URL("../data/", import.meta.url).pathname;

function fail(message) { throw new Error(`income-token-audit: ${message}`); }

export function parseOptions(argv) {
  const options = { account: "", symbol: "", record: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const take = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail(`${flag} requires a value`);
      index += 1;
      return value;
    };
    if (flag === "--account") options.account = take().toLowerCase();
    else if (flag === "--symbol") options.symbol = take().toUpperCase();
    else if (flag === "--record") options.record = true;
    else fail(`unknown argument ${flag}`);
  }
  if (!/^[a-z][a-z0-9.-]{2,15}$/u.test(options.account)) fail("--account must be a canonical Hive account name");
  if (!(options.symbol in SUPPORTED)) fail(`--symbol must be one admitted income token: ${Object.keys(SUPPORTED).join(", ")}`);
  return Object.freeze(options);
}

async function historyFrom(provider, account) {
  let problem = "unavailable";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const rows = await new RpcClient({ nodes: [provider], timeout: 15000 }).call("condenser_api.get_account_history", [account, -1, HISTORY_LIMIT]);
      if (!Array.isArray(rows)) throw new Error("malformed RPC result");
      return Object.freeze({ provider, status: "available", rows });
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
  }
  return Object.freeze({ provider, status: "unavailable", problem });
}

function distributionsFrom(rows, account, payer, symbol) {
  return Object.freeze(rows.map((row) => incomeTokenDistributionFromHistoryRow(row, account, payer, symbol))
    .filter((entry) => entry !== null)
    .sort((left, right) => left.historyIndex - right.historyIndex));
}

export async function scanIncomeTokenDistributions(account, symbol) {
  const payer = SUPPORTED[symbol];
  if (!payer) fail(`unsupported income token ${symbol}`);
  const observations = await Promise.all(HIVE_NODES.map((provider) => historyFrom(provider, account)));
  const attested = attestProviders(observations, (entry) => distributionsFrom(entry.rows, account, payer, symbol));
  if (attested.value !== "true") {
    const unavailable = attested.unavailable.map((entry) => `${entry.provider}: ${entry.problem}`);
    fail(attested.refusal === "provider-state-contested" ? "independent Hive providers returned contradictory distribution histories"
      : `fewer than two Hive providers supplied distribution history${unavailable.length ? ` (${unavailable.join("; ")})` : ""}`);
  }
  const [agreed] = attested.groups.values();
  return Object.freeze({
    kind: "aagaard.income-token-distribution-scan",
    account,
    payer,
    symbol,
    requestedLimit: HISTORY_LIMIT,
    oldestHistoryIndex: agreed.state.at(0)?.historyIndex ?? null,
    newestHistoryIndex: agreed.state.at(-1)?.historyIndex ?? null,
    evidenceProviders: Object.freeze([...agreed.providers].sort()),
    distributions: agreed.state,
  });
}

export async function operate(options) {
  const [scan, exit] = await Promise.all([
    scanIncomeTokenDistributions(options.account, options.symbol),
    makeExitReport({ account: options.account, symbol: options.symbol, quantity: "" }),
  ]);
  const observedAt = new Date().toISOString();
  const position = summarizeIncomeTokenPosition({ scan, observedAt, exit });
  const recorded = options.record ? await recordIncomeTokenDistributions(DATA_DIR, scan, observedAt) : Object.freeze([]);
  return Object.freeze({
    kind: "aagaard.income-token-audit",
    mode: options.record ? "record-verified-distributions" : "read-only",
    position,
    settlement: Object.freeze({ appendedEventCount: recorded.length, appendOnlyCategory: options.record ? "aagaard.income-token-distribution-event" : null }),
    credentialAccess: false,
    chainMutation: false,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { process.stdout.write(`${JSON.stringify(await operate(parseOptions(process.argv.slice(2))), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}

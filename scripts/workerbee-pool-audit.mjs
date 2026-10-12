#!/usr/bin/env node
import { RpcClient } from "@red-cup-engineering/hive-blockchain-client-service/rpc.mjs";
import { providerMajority } from "../src/core/hiveScriptSupport.mjs";
// Read-only WORKERBEE pool settlement boundary. Expected mining output is not
// realized yield: only exact ph1102 -> michael561 transfers, observed in a
// majority Hive history and confirmed by two Hive Engine nodes, are recorded.

import { pathToFileURL } from "node:url";

import { recordWorkerBeePoolDistributions } from "../src/core/workerBeePoolSettlement.mjs";
import { reconcileWorkerBeePoolDistribution } from "@red-cup-engineering/workerbee-services-section/pool";
import { workerBeePoolTransfersFromHistoryRow } from "@red-cup-engineering/workerbee-services-section/pool";
import { accountsWithLane } from "../src/core/accountStrategy.mjs";

const RPC_OPTIONS = Object.freeze({ timeout: 15000 });
const ACCOUNT = accountsWithLane("workerbee-yield")[0] ?? "";
const POOL = "ph1102";
const HIVE_NODES = ["https://api.hive.blog", "https://api.openhive.network", "https://api.deathwing.me"];
const CONTRACT_NODES = ["https://api.hive-engine.com/rpc/contracts", "https://herpc.dtools.dev/contracts"];
const BLOCKCHAIN_NODES = ["https://api.hive-engine.com/rpc/blockchain", "https://herpc.dtools.dev/blockchain"];
const DATA_DIR = new URL("../data/", import.meta.url).pathname;

function fail(message) { throw new Error(`workerbee-pool-audit: ${message}`); }

export function parseOptions(argv) {
  const options = { account: "", record: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--record") options.record = true;
    else if (argument === "--account") {
      const value = argv[index + 1]; if (!value || value.startsWith("--")) fail("--account requires a value");
      options.account = value.toLowerCase(); index += 1;
    } else fail(`unknown argument ${argument}`);
  }
  if (options.account !== ACCOUNT) fail(`--account must be the account whose strategy config runs this lane (${ACCOUNT || "none configured"})`);
  return Object.freeze(options);
}



async function readDelegation(node) {
  const [delegations, beeBalances] = await Promise.all([
    new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("find", { contract: "tokens", table: "delegations", query: { from: ACCOUNT, to: POOL, symbol: "WORKERBEE" }, limit: 2, offset: 0, indexes: [] }),
    new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("find", { contract: "tokens", table: "balances", query: { account: ACCOUNT, symbol: "BEE" }, limit: 2, offset: 0, indexes: [] }),
  ]);
  if (!Array.isArray(delegations) || delegations.length !== 1 || !Array.isArray(beeBalances) || beeBalances.length > 1) fail(`${node} returned non-unique pool state`);
  const row = delegations[0]; const balance = beeBalances[0] ?? { balance: "0.00000000", stake: "0.00000000" };
  if (row.from !== ACCOUNT || row.to !== POOL || row.symbol !== "WORKERBEE" || !/^(?:0|[1-9][0-9]*)\.[0-9]{5}$/.test(String(row.quantity))
    || !Number.isSafeInteger(row.created) || row.created <= 0
    || !/^(?:0|[1-9][0-9]*)\.[0-9]{8}$/.test(String(balance.balance))
    || !/^(?:0|[1-9][0-9]*)\.[0-9]{8}$/.test(String(balance.stake))) fail(`${node} returned malformed pool state`);
  return Object.freeze({ from: row.from, to: row.to, symbol: row.symbol, quantity: row.quantity,
    createdAt: new Date(row.created).toISOString(), bee: Object.freeze({ liquid: balance.balance, staked: balance.stake }) });
}

const majority = (rows) => providerMajority(rows, fail, "exact pool evidence");

async function observe(account) {
  const delegationRows = await Promise.all(CONTRACT_NODES.map(async (node) => Object.freeze({ node, value: await readDelegation(node) })));
  const delegation = majority(delegationRows);
  const historyRows = await Promise.all(HIVE_NODES.map(async (node) => {
    const rows = await new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("condenser_api.get_account_history", [POOL, -1, 1000]);
    if (!Array.isArray(rows)) fail(`${node} returned malformed pool history`);
    const value = Object.freeze(rows.flatMap((row) => workerBeePoolTransfersFromHistoryRow(row, delegation.value.createdAt, ACCOUNT)));
    return Object.freeze({ node, value });
  }));
  const history = majority(historyRows);
  const distributions = [];
  for (const candidate of history.value) {
    const observations = await Promise.all(BLOCKCHAIN_NODES.map(async (provider) => Object.freeze({ provider,
      result: await new RpcClient({ nodes: [provider], timeout: (RPC_OPTIONS).timeout }).call("getTransactionInfo", { txid: candidate.transactionId }) })));
    distributions.push(reconcileWorkerBeePoolDistribution(candidate, observations));
  }
  return Object.freeze({ delegation, history, distributions: Object.freeze(distributions) });
}

export async function operate(options) {
  const observedAt = new Date().toISOString();
  const observed = await observe(options.account);
  const recorded = options.record ? await recordWorkerBeePoolDistributions(DATA_DIR, observed.distributions, observedAt) : Object.freeze([]);
  return Object.freeze({ kind: "aagaard.workerbee-pool-audit", account: options.account, observedAt,
    delegation: Object.freeze({ ...observed.delegation.value, evidenceProviders: observed.delegation.providers }),
    distributionHistoryProviders: observed.history.providers,
    settledDistributions: observed.distributions,
    settlement: Object.freeze({ appendedEventCount: recorded.length,
      appendOnlyCategory: options.record ? "aagaard.workerbee-pool-distribution-event" : null }),
    decision: observed.distributions.length === 0 ? "preserve-delegation-await-first-weekly-settlement" : "preserve-delegation-yield-settled",
    expectedYieldIsRealizedYield: false, credentialAccess: false, chainMutation: false });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { process.stdout.write(`${JSON.stringify(await operate(parseOptions(process.argv.slice(2))), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}

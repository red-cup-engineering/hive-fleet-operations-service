#!/usr/bin/env node
// CLI adapter for the fleet's automatic-arbitrage capability. The actual
// transformation belongs in src/core so the runtime and this command share
// one observation → proof → execution → effect route.
import { pathToFileURL } from "node:url";
import { reportFailure } from "../src/commandFailure.mjs";
import { accountsWithLane } from "../src/core/accountStrategy.mjs";
import {
  automaticArbitrageSellLegRequest,
  automaticArbitrageSwapLegRequest,
  operateAutomaticArbitrage,
  selectAutomaticArbitrageOpportunity,
} from "../src/core/automaticArbitrageCycle.mjs";

const AUTONOMOUS_ACCOUNTS = Object.freeze(accountsWithLane("arbitrage"));
const DEFAULT_ACCOUNT = AUTONOMOUS_ACCOUNTS[0] ?? "";

function requireAccount(account) {
  if (!AUTONOMOUS_ACCOUNTS.includes(account)) throw new Error("automatic-arbitrage-cycle: --account must name an admitted autonomous account");
  return account;
}

export function selectOpportunity(scan, account = DEFAULT_ACCOUNT) {
  return selectAutomaticArbitrageOpportunity(scan, account, AUTONOMOUS_ACCOUNTS);
}

export function swapLegRequest(opportunity, account = DEFAULT_ACCOUNT, pricedOverheadSwapHive) {
  return automaticArbitrageSwapLegRequest(opportunity, requireAccount(account), pricedOverheadSwapHive, AUTONOMOUS_ACCOUNTS);
}

export function sellLegRequest(opportunity, account = DEFAULT_ACCOUNT, pricedOverheadSwapHive) {
  return automaticArbitrageSellLegRequest(opportunity, requireAccount(account), pricedOverheadSwapHive, AUTONOMOUS_ACCOUNTS);
}

export async function operate({ account = DEFAULT_ACCOUNT, ...options } = {}) {
  return operateAutomaticArbitrage({ account: requireAccount(account), admittedAccounts: AUTONOMOUS_ACCOUNTS, ...options });
}

function parseOptions(argv) {
  let account = DEFAULT_ACCOUNT;
  let executeOne = false;
  let dataDir;
  const recover = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--account") account = argv[++index] ?? "";
    else if (argv[index] === "--execute-one") executeOne = true;
    else if (argv[index] === "--data-dir") {
      dataDir = argv[++index];
      if (!dataDir || dataDir.startsWith("--")) throw new Error("--data-dir requires the fleet's data directory");
    }
    else if (argv[index] === "--recover-swap") recover.swap = argv[++index];
    else if (argv[index] === "--recover-sell") recover.sell = argv[++index];
    else throw new Error(`automatic-arbitrage-cycle: unknown argument ${argv[index]}`);
  }
  return { account: requireAccount(account), executeOne, ...(dataDir ? { dataDir } : {}), recover };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  operate(parseOptions(process.argv.slice(2))).then((receipt) => process.stdout.write(`${JSON.stringify(receipt)}\n`)).catch(reportFailure);
}

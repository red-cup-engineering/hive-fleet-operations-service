#!/usr/bin/env node
// CLI adapter for public Hive-Engine observation. The networking work lives
// with the other Hive-Engine adapters; this file only supplies fleet scope and
// command-line parsing.
import { pathToFileURL } from "node:url";
import { FLEET_ACCOUNTS } from "../src/core/core.adapter.mjs";
import { accountsWithLane } from "../src/core/accountStrategy.mjs";
import { observeGlobalArbitrage } from "../src/integrations/hive-engine/globalArbitrage.adapter.mjs";

const DEFAULT_ACCOUNT = accountsWithLane("arbitrage")[0] ?? "";

export async function observe({ account = DEFAULT_ACCOUNT } = {}) {
  return observeGlobalArbitrage({ account, fleetAccounts: FLEET_ACCOUNTS });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const account = args.length === 0 ? DEFAULT_ACCOUNT : args.length === 2 && args[0] === "--account" ? args[1] : null;
  try {
    if (account === null) throw new TypeError("usage: global-arbitrage-scan.mjs [--account FLEET_ACCOUNT]");
    process.stdout.write(`${JSON.stringify(await observe({ account }), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

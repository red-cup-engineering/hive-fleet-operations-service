#!/usr/bin/env node
// Run one read-only fleet shadow tick against live Hive and Hive-Engine data.
// No write boundary is installed, so this script cannot broadcast even if
// role-key files happen to exist on the host.
//
//   node scripts/run-tick.mjs

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAagaardRuntime,
  createHiveClient,
  createHiveEngineClient,
  ensureStore,
  loadAagaardConfig,
  renderFleetReport,
} from "../src/index.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(HERE, "..");

const config = loadAagaardConfig({ configPath: path.join(appRoot, "aagaard.config.json") });
const store = ensureStore(appRoot);
const hive = config.hive.enabled ? createHiveClient(config.hive) : undefined;
const hiveEngine = config.hiveEngine.enabled ? createHiveEngineClient(config.hiveEngine) : undefined;

const runtime = createAagaardRuntime(config, store, {
  ...(hive ? { hive } : {}),
  ...(hiveEngine ? { market: hiveEngine } : {}),
});

console.log(`running one read-only shadow tick against live Hive data (hive reads: ${config.hive.enabled}, hive-engine reads: ${config.hiveEngine.enabled})...`);
const readout = await runtime.runTick();
console.log(`tick complete: ${readout.accounts.length} accounts, ${readout.witness.rows} witness rows (${readout.witness.uniqueWitnesses} unique, ${readout.witness.duplicateWitnesses} duplicate)`);
for (const account of readout.accounts) {
  console.log(`  ${account.account}: votes ${account.voting?.votesPlanned ?? 0} planned/${account.voting?.votesBroadcast ?? 0} broadcast, trades ${account.trading?.tradesPlanned ?? 0} planned (mode ${account.trading?.mode})`);
}

console.log("\n" + "=".repeat(60));
console.log(renderFleetReport(store.dataDir, config.wallets.map((w) => w.account)));

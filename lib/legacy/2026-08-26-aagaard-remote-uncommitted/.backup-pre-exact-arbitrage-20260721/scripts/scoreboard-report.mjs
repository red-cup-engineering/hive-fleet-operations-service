#!/usr/bin/env node
// Print the fleet's scoreboard: did the strategy beat just holding, and by
// how much, per account, since genesis. Reads data/scoreboard/ under the
// given root (default: repo root's own data/ directory).
//
//   node scripts/scoreboard-report.mjs
//   node scripts/scoreboard-report.mjs --root /path/to/store --account sigmund-vexler

import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderFleetReport, loadAagaardConfig } from "../src/index.mts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const root = argValue("--root") ?? path.join(HERE, "..");
const scoreboardDir = path.join(root, "data", "scoreboard");
const onlyAccount = argValue("--account");

const config = loadAagaardConfig();
const accounts = onlyAccount ? [onlyAccount] : config.wallets.map((wallet) => wallet.account);

console.log(`Aagaard scoreboard -- ${new Date().toISOString()}`);
console.log(`store: ${scoreboardDir}`);
console.log("=".repeat(60));
console.log(renderFleetReport(scoreboardDir, accounts));

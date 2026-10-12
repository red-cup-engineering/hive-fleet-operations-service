#!/usr/bin/env node

import { fileURLToPath, pathToFileURL } from "node:url";

import { observeOpportunityFeed } from "../src/opportunity-feed.mjs";
import { observe as observeGlobalArbitrage } from "./global-arbitrage-scan.mjs";
import { observe as observePoolCycle } from "./exact-pool-cycle-assay.mjs";
import { observe as observeGames } from "./game-opportunity-cycle.mjs";
import { priceResourceCosts } from "../src/core/resourceCostModel.mjs";
import { accountsWithLane } from "../src/core/accountStrategy.mjs";

const RESOURCE_COST_ACCOUNT = accountsWithLane("arbitrage")[0] ?? "";
// A deliberately large sentinel: this feed is read-only display, never an
// execution gate (see automatic-arbitrage-cycle.mjs for the real,
// per-opportunity gate), so pricing here always tries to show the
// measured component amounts rather than gating on any one candidate's
// worst-case edge.
const RESOURCE_COST_DISPLAY_SENTINEL_SWAP_HIVE = "999999.00000000";
const MACHINES_RECORD_PATH = fileURLToPath(new URL(
  "../../../../../../../../../../../../561-group-services-section/data/records/2026-08-30-org-machines.json",
  import.meta.url,
));

async function observeResourceCost() {
  return priceResourceCosts({ account: RESOURCE_COST_ACCOUNT,
    worstCaseProfitSwapHive: RESOURCE_COST_DISPLAY_SENTINEL_SWAP_HIVE, machinesRecordPath: MACHINES_RECORD_PATH });
}

const providers = Object.freeze({
  globalArbitrage: observeGlobalArbitrage,
  poolCycle: observePoolCycle,
  games: observeGames,
  resourceCost: observeResourceCost,
});

export async function observe({ observeFeed = observeOpportunityFeed, ...options } = {}) {
  return observeFeed({ providers, ...options });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { process.stdout.write(`${JSON.stringify(await observe(), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}

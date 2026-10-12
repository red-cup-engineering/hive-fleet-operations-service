#!/usr/bin/env node
// Cycle 36 closes from the witnessed BRO audit and its already
// durable native-HIVE receipts.  It has no key, signer, buy, sell, stake, or
// transfer surface.

import { pathToFileURL } from "node:url";

import { recordAssetUtilityCycle } from "../src/core/assetUtilityCycleSettlement.mjs";
import { readIncomeTokenDistributions } from "../src/core/incomeTokenSettlement.mjs";
import { operate as auditIncomeToken } from "./income-token-audit.mjs";

const DATA_DIR = new URL("../data/", import.meta.url).pathname;
const PROCUREMENT_RESIDUE = "an A2A SEN operation must carry exactly one application/sen+cbor raw part";
function fail(message) { throw new Error(`asset-utility-cycle: ${message}`); }

export function parseOptions(argv) {
  if (argv.length === 1 && argv[0] === "--record") return Object.freeze({ record: true });
  fail("only --record is admitted");
}

export async function operate(options) {
  if (!options.record) fail("durable recording is required");
  const audit = await auditIncomeToken({ account: "emsenn0", symbol: "BRO", record: true });
  const distributions = readIncomeTokenDistributions(DATA_DIR, "emsenn0", "BRO");
  const event = await recordAssetUtilityCycle(DATA_DIR, { audit, distributions, procurementResidue: PROCUREMENT_RESIDUE });
  return Object.freeze({ kind: "aagaard.asset-utility-cycle-receipt", cycle: event.cycle, position: event.position,
    decision: event.decision, durableRecord: Object.freeze({ confirmed: true, eventId: event.eventId }),
    capitalMoved: event.capitalMoved, realizedCycleIncome: event.realizedCycleIncome,
    credentialAccess: false, chainMutation: false, nextAngle: "product-revenue", observedAt: new Date().toISOString() });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { process.stdout.write(`${JSON.stringify(await operate(parseOptions(process.argv.slice(2))), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}

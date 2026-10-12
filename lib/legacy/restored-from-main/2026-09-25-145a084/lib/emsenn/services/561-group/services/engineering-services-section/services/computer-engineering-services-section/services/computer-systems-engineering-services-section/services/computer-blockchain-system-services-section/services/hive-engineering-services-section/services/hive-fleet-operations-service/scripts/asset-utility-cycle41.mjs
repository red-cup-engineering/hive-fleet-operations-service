#!/usr/bin/env node
// Cycle 41 prioritizes the largest exact recoverable position. It records a
// pending HBD delivery witness and compares alternatives without a signer.
import { pathToFileURL } from "node:url";
import { hbdSavingsRecoveryEvent } from "../src/core/hbdSavingsRecoverySettlement.mjs";
import { recordAssetUtilityCycle41 } from "../src/core/assetUtilityCycle41Settlement.mjs";
import { operate as observeRecovery } from "./hbd-savings-recovery.mjs";
import { operate as observeWorkerBee } from "./workerbee-yield.mjs";
import { operate as observePool } from "./workerbee-pool-audit.mjs";
import { operate as observeHolozing } from "./holozing-rewards.mjs";
import { operate as observeTerraCore } from "./terracore-cycle.mjs";
const DATA_DIR = new URL("../data/", import.meta.url).pathname; const RESIDUE = "Agent Card has no valid signature";
function fail(message) { throw new Error(`asset-utility-cycle41: ${message}`); }
export function parseOptions(argv) { if (argv.length === 1 && argv[0] === "--record") return Object.freeze({ record: true }); fail("only --record is admitted"); }
export async function operate(options) {
  if (!options.record) fail("durable recording is required");
  const recoveryReceipt = await observeRecovery({ account: "michael561", record: false });
  if (!["pending", "delivered"].includes(recoveryReceipt.status)) fail("the current exact recovery observation is not chain-confirmed");
  const recovery = hbdSavingsRecoveryEvent(recoveryReceipt);
  // Serialize broad public readers so provider throttling cannot masquerade
  // as contradictory asset evidence.
  const workerBee = await observeWorkerBee({ account: "michael561", keyFile: "", executeOne: false, settleTx: "" });
  const pool = await observePool({ account: "michael561", record: false });
  const holozing = await observeHolozing({ account: "michael561", keyFile: "", executeOne: false });
  const terraCore = await observeTerraCore({ account: "michael561", keyFile: "", executeOne: false, recoverTx: "" });
  const event = await recordAssetUtilityCycle41(DATA_DIR, { recovery, workerBee, pool, holozing, terraCore, procurementResidue: RESIDUE });
  return Object.freeze({ kind: "aagaard.asset-utility-cycle-41-receipt", cycle: event.cycle, recovery: event.recovery,
    alternatives: event.alternatives, decision: event.decision, durableRecord: Object.freeze({ confirmed: true, eventId: event.eventId }),
    capitalMoved: event.capitalMoved, realizedCycleIncome: null, credentialAccess: false, chainMutation: false,
    nextAngle: "product-revenue", observedAt: new Date().toISOString() });
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) { try { process.stdout.write(`${JSON.stringify(await operate(parseOptions(process.argv.slice(2))), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; } }

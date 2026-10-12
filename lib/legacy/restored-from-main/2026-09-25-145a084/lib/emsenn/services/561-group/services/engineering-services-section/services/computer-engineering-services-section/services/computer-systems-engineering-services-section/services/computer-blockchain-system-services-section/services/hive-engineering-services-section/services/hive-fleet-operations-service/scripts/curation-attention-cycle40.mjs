#!/usr/bin/env node
// Cycle 40 joins one already-durable vote to a fresh independent reward
// baseline and settlement telemetry. It has no signer, key, vote, or transfer.

import { pathToFileURL } from "node:url";

import { readCurationActions } from "../src/core/curationActionSettlement.mjs";
import { recordCurationCycle40 } from "../src/core/curationCycle40Settlement.mjs";
import { readCurationCycles } from "../src/core/curationCycleSettlement.mjs";
import { readCurationTelemetry } from "../src/core/curationSettlement.mjs";
import { observe as observeBaseline } from "./curation-reward-baseline.mjs";

const DATA_DIR = new URL("../data/", import.meta.url).pathname;
const PRIOR_ID = "urn:aagaard:curation-cycle:DPNzSfYyOowKtEIYspETgdxmC34gdL2qLbuJe6iqXQQ";
const ACTION_ID = "urn:aagaard:curation-action:4Nn4gehXP55V26iRsqdUgQZjORJpbvZoyZAoWqWkpjM";
const PROCUREMENT_RESIDUE = "timed out awaiting tools/call after 300s";
function fail(message) { throw new Error(`curation-attention-cycle40: ${message}`); }
export function parseOptions(argv) { if (argv.length === 1 && argv[0] === "--record") return Object.freeze({ record: true }); fail("only --record is admitted"); }

export async function operate(options) {
  if (!options.record) fail("durable recording is required");
  const prior = readCurationCycles(DATA_DIR).find((event) => event.eventId === PRIOR_ID);
  const action = readCurationActions(DATA_DIR).find((event) => event.eventId === ACTION_ID);
  if (!prior || !action) fail("the exact prior cycle and current vote must already be durable");
  const baseline = await observeBaseline(); const telemetry = readCurationTelemetry(DATA_DIR, "emsenn0", "available");
  const event = await recordCurationCycle40(DATA_DIR, { prior, action, baseline, telemetry, procurementResidue: PROCUREMENT_RESIDUE });
  return Object.freeze({ kind: "aagaard.curation-attention-cycle-40-receipt", cycle: event.cycle, vote: event.vote,
    rewardTelemetry: event.rewardTelemetry, baselineComparison: event.baselineComparison, rectification: event.rectification,
    durableRecord: Object.freeze({ confirmed: true, eventId: event.eventId }), capitalMoved: event.capitalMoved,
    nextAngle: "asset-utility-yield", credentialAccess: false, chainMutation: false, observedAt: new Date().toISOString() });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { process.stdout.write(`${JSON.stringify(await operate(parseOptions(process.argv.slice(2))), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}

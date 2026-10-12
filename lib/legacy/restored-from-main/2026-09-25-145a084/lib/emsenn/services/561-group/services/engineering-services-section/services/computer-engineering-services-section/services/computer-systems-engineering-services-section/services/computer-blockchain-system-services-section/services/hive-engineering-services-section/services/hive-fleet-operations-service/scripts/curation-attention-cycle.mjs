#!/usr/bin/env node
// Cycle 35 post-action settlement. It reads the already durable exact vote,
// obtains an independent reward baseline, and appends one cycle witness. It
// has no signer, key, vote, claim, or transfer surface.

import { pathToFileURL } from "node:url";

import { readCurationActions } from "../src/core/curationActionSettlement.mjs";
import { recordCurationCycle } from "../src/core/curationCycleSettlement.mjs";
import { observe as observeBaseline } from "./curation-reward-baseline.mjs";

const DATA_DIR = new URL("../data/", import.meta.url).pathname;
function fail(message) { throw new Error(`curation-attention-cycle: ${message}`); }
export function parseOptions(argv) { if (argv.length === 1 && argv[0] === "--record") return Object.freeze({ record: true }); fail("only --record is admitted"); }

export async function operate(options) {
  if (!options.record) fail("durable recording is required");
  const action = [...readCurationActions(DATA_DIR)].reverse().find((row) => row.transactionId === "120fb9398fee3a3a217d0d1e6c8899312c61877d");
  if (!action) fail("the exact cycle-35 curation action is not durable");
  const baseline = await observeBaseline(); const event = await recordCurationCycle(DATA_DIR, { action, baseline });
  return Object.freeze({ kind: "aagaard.curation-attention-cycle-receipt", cycle: event.cycle, vote: event.vote,
    baseline: event.baseline, durableRecord: Object.freeze({ confirmed: true, eventId: event.eventId }),
    nextAngle: "asset-utility-yield", credentialAccess: false, chainMutation: false, observedAt: new Date().toISOString() });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { process.stdout.write(`${JSON.stringify(await operate(parseOptions(process.argv.slice(2))), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}

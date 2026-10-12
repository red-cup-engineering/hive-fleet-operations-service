#!/usr/bin/env node
// Cycle 37 re-observes the one live pilot and records why neither a reblog nor
// a second SKU is admitted. It has no key, signer, invoice, payment, delivery,
// post, reblog, or asset-movement surface.

import { pathToFileURL } from "node:url";

import { recordProductRevenueCycle37 } from "../src/core/productRevenueCycle37Settlement.mjs";
import { observe as monitorOffer } from "./monitor-exit-tightness-pilot.mjs";
import { observe as planDistribution } from "./plan-product-pilot-distribution.mjs";

const DATA_DIR = new URL("../data/", import.meta.url).pathname;
const PROCUREMENT_RESIDUE = "an A2A SEN operation must carry exactly one application/sen+cbor raw part";
function fail(message) { throw new Error(`product-revenue-cycle37: ${message}`); }

export function parseOptions(argv) {
  if (argv.length === 1 && argv[0] === "--record") return Object.freeze({ record: true });
  fail("only --record is admitted");
}

export async function operate(options) {
  if (!options.record) fail("durable recording is required");
  const [monitor, distributionPlan] = await Promise.all([monitorOffer(), planDistribution()]);
  const event = await recordProductRevenueCycle37(DATA_DIR, { monitor, distributionPlan, procurementResidue: PROCUREMENT_RESIDUE });
  return Object.freeze({ kind: "aagaard.product-revenue-cycle-37-receipt", cycle: event.cycle, offer: event.offer,
    engagement: event.engagement, distribution: event.distribution, decision: event.decision,
    durableRecord: Object.freeze({ confirmed: true, eventId: event.eventId }), capitalMoved: event.capitalMoved,
    credentialAccess: false, chainMutation: false, nextAngle: "games-capability", observedAt: new Date().toISOString() });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { process.stdout.write(`${JSON.stringify(await operate(parseOptions(process.argv.slice(2))), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}

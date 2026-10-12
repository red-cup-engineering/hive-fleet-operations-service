#!/usr/bin/env node
// Cycle 32: join witnessed demand, incoming HBD, and the exact
// RC-bounded distribution plan. Recording writes only through Aagaard's hired
// It has no credential or chain-mutation path.

import { pathToFileURL } from "node:url";

import { recordProductRevenueCycle } from "../src/core/productRevenueCycleSettlement.mjs";
import { observe as monitorOffer } from "./monitor-exit-tightness-pilot.mjs";
import { observe as planDistribution } from "./plan-product-pilot-distribution.mjs";

const DATA_DIR = new URL("../data/", import.meta.url).pathname;
function fail(message) { throw new Error(`product-revenue-cycle: ${message}`); }

export function parseOptions(argv) {
  if (argv.length === 0) return Object.freeze({ record: false });
  if (argv.length === 1 && argv[0] === "--record") return Object.freeze({ record: true });
  fail(`unknown argument ${argv[0]}`);
}

export async function operate(options) {
  const [monitor, distributionPlan] = await Promise.all([monitorOffer(), planDistribution()]);
  const observedAt = new Date().toISOString();
  const event = options.record ? await recordProductRevenueCycle(DATA_DIR, { monitor, distributionPlan, recordedAt: observedAt }) : null;
  return Object.freeze({ kind: "aagaard.product-revenue-cycle-receipt", cycle: Object.freeze({ globalStep: 32, angle: "product-revenue" }),
    monitor, distributionPlan, durableRecord: Object.freeze({ confirmed: event !== null, eventId: event?.eventId ?? null }),
    nextAngle: "games-capability", credentialAccess: false, chainMutation: false, observedAt });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { process.stdout.write(`${JSON.stringify(await operate(parseOptions(process.argv.slice(2))), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}

#!/usr/bin/env node
// Cycle 42 binds the independently confirmed direct-RC allocation, the one
// qualified product reblog, and the still-zero commercial funnel. It has no
// signer or key surface; both chain acts must already exist durably.

import { pathToFileURL } from "node:url";

import { readDirectRcDelegations } from "../src/core/directRcDelegationSettlement.mjs";
import { readProductPilotEvents } from "../src/core/productPilotSettlement.mjs";
import { recordProductRevenueCycle42 } from "../src/core/productRevenueCycle42Settlement.mjs";
import { observe as monitorOffer } from "./monitor-exit-tightness-pilot.mjs";

const DATA_DIR = new URL("../data/", import.meta.url).pathname;
const RC_TX = "c8f420adfbaafcac33066fee5fed70a98a40b53e";
const DISTRIBUTION_TX = "32a53e0c8de93ef7431993e54b92549416c1281d";
const PROCUREMENT_RESIDUE = "an A2A SEN operation must carry exactly one application/sen+cbor raw part";
function fail(message) { throw new Error(`product-revenue-cycle42: ${message}`); }

export function parseOptions(argv) { if (argv.length === 1 && argv[0] === "--record") return Object.freeze({ record: true });
  fail("only --record is admitted"); }

export async function operate(options) {
  if (!options.record) fail("durable recording is required");
  const delegation = (await readDirectRcDelegations(DATA_DIR)).find((row) => row.status === "delegation-confirmed" && row.transactionId === RC_TX);
  const distribution = readProductPilotEvents(DATA_DIR).find((row) => row.event === "offer-distribution"
    && row.status === "distributed-confirmed" && row.transactionId === DISTRIBUTION_TX);
  if (!delegation || !distribution) fail("the exact confirmed RC allocation and distribution events must both be durable");
  const monitor = await monitorOffer();
  const event = await recordProductRevenueCycle42(DATA_DIR, { monitor, delegation, distribution,
    procurementResidue: PROCUREMENT_RESIDUE });
  return Object.freeze({ kind: "aagaard.product-revenue-cycle-42-receipt", cycle: event.cycle,
    funnel: event.funnel, resourceAllocation: event.resourceAllocation, distribution: event.distribution,
    decision: event.decision, capitalMoved: event.capitalMoved, durableRecord: Object.freeze({ confirmed: true, eventId: event.eventId }),
    credentialAccess: false, chainMutation: false, nextAngle: "games-capability", observedAt: new Date().toISOString() });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { process.stdout.write(`${JSON.stringify(await operate(parseOptions(process.argv.slice(2))), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}

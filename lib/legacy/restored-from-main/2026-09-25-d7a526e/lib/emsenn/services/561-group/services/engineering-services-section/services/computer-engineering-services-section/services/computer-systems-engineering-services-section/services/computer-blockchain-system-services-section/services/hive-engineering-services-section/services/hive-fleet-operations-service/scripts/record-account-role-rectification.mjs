#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { recordAccountRoleRectification } from "../src/core/accountRoleRectificationSettlement.mjs";
import { readExitValuePublications } from "../src/core/exitValueServicePublicationSettlement.mjs";
import { observe as monitorMerchant } from "./monitor-exit-value-service.mjs";
const DATA_DIR = new URL("../data/", import.meta.url).pathname; const RESIDUE = "an A2A SEN operation must carry exactly one application/sen+cbor raw part";
function fail(message) { throw new Error(`record-account-role-rectification: ${message}`); }
export function parseOptions(argv) { if (argv.length === 1 && argv[0] === "--record") return Object.freeze({ record: true }); fail("only --record is admitted"); }
export async function operate(options) { if (!options.record) fail("durable recording is required"); const publications = readExitValuePublications(DATA_DIR);
  const merchant = publications.find((row) => row.publicationKind === "merchant"); const editorial = publications.find((row) => row.publicationKind === "editorial");
  if (!merchant || !editorial) fail("both exact publications must already be durable"); const monitor = await monitorMerchant();
  const event = await recordAccountRoleRectification(DATA_DIR, { merchant, editorial, monitor, procurementResidue: RESIDUE });
  return Object.freeze({ kind: "aagaard.account-role-rectification-receipt", roles: event.roles,
    historicalMispublication: event.historicalMispublication, merchantMonitor: event.merchantMonitor,
    durableRecord: Object.freeze({ confirmed: true, eventId: event.eventId }), credentialAccess: false, chainMutation: false }); }
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) { try { process.stdout.write(`${JSON.stringify(await operate(parseOptions(process.argv.slice(2))), null, 2)}\n`); }
catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; } }

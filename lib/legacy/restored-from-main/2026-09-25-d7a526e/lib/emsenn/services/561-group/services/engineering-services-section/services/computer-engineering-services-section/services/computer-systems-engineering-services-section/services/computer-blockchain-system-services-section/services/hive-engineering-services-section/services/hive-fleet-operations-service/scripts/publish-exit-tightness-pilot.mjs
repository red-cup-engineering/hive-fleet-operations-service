#!/usr/bin/env node
// Historical projection only. The emsenn0 pilot publication cannot be moved
// or rewritten, and its signer was retired when emsenn0 became vote-only.

import { pathToFileURL } from "node:url";
import { exitTightnessPilotOffer } from "../src/core/exitTightnessPilotPost.mjs";
function fail(message) { throw new Error(`publish-exit-tightness-pilot: ${message}`); }
export function parseOptions(argv) { if (argv.length !== 0) fail("publication signer retired; this command is historical observe-only");
  return Object.freeze({ observeOnly: true }); }
export async function operate(options) { if (options?.observeOnly !== true) fail("historical observation is required");
  return Object.freeze({ ...exitTightnessPilotOffer(), status: "historical-mispublication-preserved",
    canonicalRoles: Object.freeze({ curator: "emsenn0", publisher: "sigmund-vexler", merchant: "help-fund" }),
    credentialAccess: false, chainMutation: false, signerRetired: true }); }
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) { try { process.stdout.write(`${JSON.stringify(await operate(parseOptions(process.argv.slice(2))), null, 2)}\n`); }
catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; } }

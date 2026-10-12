#!/usr/bin/env node
// Retired after the account-role correction. Historical emsenn0 publication
// evidence remains durable, but emsenn0 is now vote-only at every signer.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const REFUSAL = "cold-red-gate product signer retired: emsenn0 is vote-only; editorial belongs to sigmund-vexler and the merchant offer to help-fund";
export function validateRemoteRequest(_request) { throw new Error(REFUSAL); }
export async function broadcastViaColdRedGate(_request) { throw new Error(REFUSAL); }
async function main() { try { JSON.parse(readFileSync(0, "utf8")); } catch { /* refusal is independent of carrier validity */ } throw new Error(REFUSAL); }
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) { try { await main(); }
catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; } }

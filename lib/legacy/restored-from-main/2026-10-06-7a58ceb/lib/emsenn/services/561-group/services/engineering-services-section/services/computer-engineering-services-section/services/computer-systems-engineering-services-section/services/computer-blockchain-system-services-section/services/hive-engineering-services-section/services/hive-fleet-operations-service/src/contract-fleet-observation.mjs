#!/usr/bin/env node
// Temporary receiving adapter: existing callers retain their journal coordinates.
// The exchange protocol and new Actor-bound hosts belong to Coesite.
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bindHiveFleetObservationJournal } from '@coesite-operations/hive-operations-services-section/journal-provider';
import { projectHiveFleetObservation } from './fleet-observation.mjs';
import { FLEET_DATA_DIR } from './core/journal.mjs';

export function createHiveFleetObservationService({ actor, dataDir, tickCategory, journalPrefix, objectKind = 'aagaard.record' }) {
  for (const [name, value] of Object.entries({ actor, dataDir, tickCategory, journalPrefix })) {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(`Hive observation provider requires ${name}`);
  }
  return bindHiveFleetObservationJournal({ actor, root: dataDir, objectKind, tickCategory, journalPrefix });
}
let existingProvider;
function aagaard() {
  return existingProvider ??= createHiveFleetObservationService({ actor: 'urn:ame:aagaard', dataDir: FLEET_DATA_DIR,
    tickCategory: 'aagaard.fleet-tick', journalPrefix: 'aagaard' });
}
export const run = (...args) => aagaard().run(...args);
export const digest = value => aagaard().digest(value);
export const projectObservation = projectHiveFleetObservation;
function arg(flag) { const index = process.argv.indexOf(flag); return index < 0 ? undefined : process.argv[index + 1]; }
if (process.argv.includes('--provider-cli') || (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
  try {
    const activity = JSON.parse(readFileSync(0, 'utf8'));
    const output = await run(activity, arg('--operation') ?? 'invoke-service', arg('--now') ?? new Date().toISOString());
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    if (output.type === 'Reject') process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${basename(process.argv[1])}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

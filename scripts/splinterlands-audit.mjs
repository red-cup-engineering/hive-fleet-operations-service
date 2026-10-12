#!/usr/bin/env node
import { reportFailure } from "../src/commandFailure.mjs";
// Read-only Splinterlands ranked audit. It deliberately stops before queueing
// a match: once queued, a team deadline and an energy-bearing result exist.

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { assessSplinterlandsOwnedModernCore } from "@red-cup-engineering/splinterlands-services-section";
import {
  SPLINTERLANDS_OPERATOR_POLICY,
  admitOneSplinterlandsQueue,
  assessOwnedModernCoverage,
} from "../src/integrations/splinterlands/splinterlandsOperator.mjs";

const API = "https://api.splinterlands.com";

function fail(message) { throw new Error(`splinterlands-audit: ${message}`); }

export function parseOptions(argv) {
  if (argv.length !== 2 || argv[0] !== "--account" || !/^[a-z][a-z0-9.-]{2,15}$/.test(argv[1])) fail("usage: --account <canonical Hive account>");
  return Object.freeze({ account: argv[1].toLowerCase() });
}

async function readJson(path) {
  const response = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) fail(`${path} returned HTTP ${response.status}`);
  return response.json();
}

export async function audit({ account }) {
  const [settings, player, collection, details, outstanding, ruleCatalog] = await Promise.all([
    readJson("/settings"),
    readJson(`/players/details?name=${encodeURIComponent(account)}`),
    readJson(`/cards/collection/${encodeURIComponent(account)}`),
    readJson("/cards/get_details"),
    readJson(`/battle/battle_queue?username=${encodeURIComponent(account)}`),
    readJson("/battle/rulesets"),
  ]);
  if (player?.name !== account) fail("player response disagrees with the requested account");
  if (collection?.player !== account || !Array.isArray(collection?.cards)) fail("collection response disagrees with the requested account");
  const modernEditions = settings?.modern_editions;
  const readiness = assessSplinterlandsOwnedModernCore(collection.cards, details, modernEditions);
  const energy = Number(player?.modern_energy ?? player?.energy ?? player?.capture_rate ?? 0);
  if (!Array.isArray(outstanding)) fail("battle queue response is not an array");
  const coverage = assessOwnedModernCoverage({
    account,
    owned: collection.cards,
    details,
    modernEditions,
    ruleCatalog,
    rankedLeague: Number(player?.modern_league ?? 0),
  });
  const queueAdmission = admitOneSplinterlandsQueue({
    account,
    energy,
    outstandingMatches: outstanding.length,
    collectionReady: readiness.kind === "ready-owned-core",
    coverageReady: coverage.readyForUnattendedQueue,
    alreadyAttempted: 0,
  });
  return Object.freeze({
    kind: "aagaard.splinterlands-ranked-audit",
    account,
    observedAt: new Date().toISOString(),
    season: Object.freeze({ id: settings?.season?.id ?? settings?.season_id ?? null, endsAt: settings?.season?.ends ?? settings?.season_end_date ?? null }),
    client: Object.freeze({ version: settings?.version ?? null, modernEditions: Object.freeze([...modernEditions]) }),
    player: Object.freeze({
      purchasedSpellbook: Boolean(player?.starter_pack_purchase),
      modernRating: Number(player?.modern_rating ?? 0),
      modernBattles: Number(player?.modern_battles ?? 0),
      modernWins: Number(player?.modern_wins ?? 0),
      modernLeague: Number(player?.modern_league ?? 0),
      energy,
    }),
    collection: Object.freeze({ total: collection.cards.length, modernOwnedUndelegated: readiness.summoners.length + readiness.monsters.length }),
    readiness,
    coverage,
    operatorPolicy: SPLINTERLANDS_OPERATOR_POLICY,
    admission: Object.freeze({
      queueConditionSatisfied: queueAdmission.kind === "queue-one",
      queueSubmitted: false,
      reason: `${queueAdmission.reason}; this audit is read-only and never submits the admitted queue action`,
    }),
  });
}

async function main() {
  process.stdout.write(`${JSON.stringify(await audit(parseOptions(process.argv.slice(2))))}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(reportFailure);
}

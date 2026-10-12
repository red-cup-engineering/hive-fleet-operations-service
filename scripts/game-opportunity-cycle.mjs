#!/usr/bin/env node
// Read-only cross-game planner. It composes the already bounded game observers
// and exact exit-depth witness, then applies categorical admission and
// lexicographic dominance. It has no credential or execution surface.

import { pathToFileURL } from "node:url";

import { rankGameOpportunities } from "../src/core/gameOpportunity.mjs";
import { operate as observeDCity } from "./dcity-recovery.mjs";
import { operate as observeDCrops } from "./dcrops-cycle.mjs";
import { operate as observeHashKings } from "./hashkings-recovery.mjs";
import { makeReport as makeExitReport } from "./hive-engine-exit-tightness.mjs";
import { operate as observeHoloZingRewards } from "./holozing-rewards.mjs";
import { audit as auditSplinterlands } from "./splinterlands-audit.mjs";
import { operate as observeTerraCore } from "./terracore-cycle.mjs";
import { accountsWithLane } from "../src/core/accountStrategy.mjs";

const ACCOUNT = accountsWithLane("games")[0] ?? "";
const DCROPS = Object.freeze({ account: ACCOUNT, keyFile: "", landID: 472218, seedID: 472217, plotNo: 0, executeOne: false });

function fail(message) { throw new Error(`game-opportunity-cycle: ${message}`); }

export function parseOptions(argv) {
  if (argv.length !== 0) fail(`unknown argument ${argv[0]}`);
  return Object.freeze({});
}

function rcDecision(observation) {
  return observation?.status === "certified" ? observation.plan.decision : "uncertified";
}

function unixEligibility(value) {
  return Number.isSafeInteger(value) && value > 0 ? new Date(value * 1_000).toISOString() : null;
}

async function boundedObservation(game, work) {
  try { return Object.freeze({ game, value: await work(), error: null }); }
  catch (error) { return Object.freeze({ game, value: null, error: error instanceof Error ? error.message : String(error) }); }
}

export async function observe() {
  const observedAt = new Date().toISOString();
  const observations = await Promise.all([
    boundedObservation("dcity", () => observeDCity({ account: ACCOUNT, keyFile: "", executeOne: false })),
    boundedObservation("dcrops", () => observeDCrops(DCROPS)),
    boundedObservation("hashkings", () => observeHashKings({ account: ACCOUNT })),
    boundedObservation("holozing-rewards", () => observeHoloZingRewards({ account: ACCOUNT, keyFile: "", executeOne: false })),
    boundedObservation("splinterlands", () => auditSplinterlands({ account: ACCOUNT })),
    boundedObservation("terracore", () => observeTerraCore({ account: ACCOUNT, keyFile: "", executeOne: false, recoverTx: "" })),
  ]);
  const lookup = Object.fromEntries(observations.map((entry) => [entry.game, entry]));
  const dcity = lookup.dcity.value; const dcrops = lookup.dcrops.value; const hashkings = lookup.hashkings.value;
  const holozingRewards = lookup["holozing-rewards"].value; const splinterlands = lookup.splinterlands.value;
  const terracore = lookup.terracore.value;
  const terracoreExit = terracore?.plan?.kind === "claim"
    ? (await boundedObservation("terracore-exit", () => makeExitReport({ account: ACCOUNT, symbol: "SCRAP", quantity: terracore.plan.amount }))).value
    : null;
  const terracoreQuote = terracoreExit?.status === "certified" && terracoreExit.valuation?.completeExit
    ? Object.freeze({ quantity: terracoreExit.valuation.grossDepthProceeds, counterSymbol: terracoreExit.valuation.counterSymbol })
    : undefined;
  const candidates = [
    {
      game: "dcity", action: "recover-closed-sim",
      executableNow: dcity?.plan?.kind === "ready", benefitClass: "treasury-protection",
      capitalRisk: "bounded", operation: "custom_json_operation", rcDecision: "uncertified",
      evidence: dcity ? "true" : "neither", protectedAssetsPreserved: dcity?.before?.cityNfts?.disposition === "preserved",
      independentReceiptAvailable: false, credentialRole: "active", nextEligibleAt: null,
      evidenceSummary: dcity ? `two sidechain providers expose ${dcity.before?.simBalance} liquid SIM and a bounded minimum of ${dcity.plan?.quote?.minimumSwapHive ?? "unknown"} SWAP.HIVE, but the recovery lane lacks RC certification and durable settlement`
        : `dCity observation unavailable: ${lookup.dcity.error}`,
      ...(dcity?.plan?.quote?.minimumSwapHive ? { treasuryFloor: { quantity: dcity.plan.quote.minimumSwapHive, counterSymbol: "SWAP.HIVE" } } : {}),
    },
    {
      game: "terracore", action: terracore?.plan?.kind === "claim" ? "claim-raid-exposed-scrap" : "one-conservative-battle",
      evidence: terracore && (terracoreExit === null || terracoreExit.status === "certified") ? "true" : "neither",
      executableNow: terracore?.plan?.kind === "claim" || terracore?.plan?.kind === "battle",
      benefitClass: terracore?.plan?.kind === "claim" ? "treasury-protection" : "productive-state",
      capitalRisk: "none", operation: "custom_json_operation", rcDecision: rcDecision(terracore?.resourceCredits),
      protectedAssetsPreserved: true, independentReceiptAvailable: true, credentialRole: "posting",
      nextEligibleAt: terracore?.resourceCredits?.status === "certified" ? terracore.resourceCredits.plan.eligibleAt : null,
      evidenceSummary: !terracore ? `TerraCore observation unavailable: ${lookup.terracore.error}` : terracore.plan?.kind === "claim"
        ? `official game state exposes ${terracore.plan.amount} raid-exposed SCRAP; two sidechain providers agree on the liquid balance${terracoreQuote ? ` and complete depth gives ${terracoreQuote.quantity} ${terracoreQuote.counterSymbol}` : ""}`
        : "official game state and the conservative target policy expose at most one bounded battle",
      ...(terracoreQuote ? { treasuryFloor: terracoreQuote } : {}),
    },
    {
      game: "dcrops", action: String(dcrops?.plan?.kind ?? "wait-for-crop"), evidence: dcrops ? "true" : "neither",
      executableNow: ["remove-expired", "plant", "harvest"].includes(dcrops?.plan?.kind),
      benefitClass: "productive-state", capitalRisk: "none", operation: "custom_json_operation",
      rcDecision: rcDecision(dcrops?.resourceCredits), protectedAssetsPreserved: true,
      independentReceiptAvailable: true, credentialRole: "active",
      nextEligibleAt: unixEligibility(dcrops?.plan?.nextEligibleAtUnix),
      evidenceSummary: dcrops ? `fresh dCrops state reports ${dcrops.plan?.kind}: ${dcrops.plan?.reason}` : `dCrops observation unavailable: ${lookup.dcrops.error}`,
    },
    {
      game: "holozing-rewards", action: "claim-pending-zing",
      executableNow: holozingRewards?.plan?.kind === "ready", benefitClass: "productive-state",
      capitalRisk: "none", operation: "none", rcDecision: "not-required",
      evidence: holozingRewards ? "true" : "neither", protectedAssetsPreserved: holozingRewards?.before?.alphaVials?.count === 1
        && JSON.stringify(holozingRewards.before?.alphaVials?.ids) === "[1831]",
      independentReceiptAvailable: true, credentialRole: "posting", nextEligibleAt: null,
      evidenceSummary: holozingRewards ? `official pending-reward state and two balance providers admit conversion of ${holozingRewards.plan?.minimumClaimZing ?? "0.000"} pending ZING into on-chain stake while preserving Alpha Vial #1831 unopened`
        : `HoloZing reward observation unavailable: ${lookup["holozing-rewards"].error}`,
    },
    {
      game: "holozing-wilds", action: "bounded-no-capture-session", evidence: "true", executableNow: true,
      benefitClass: "resettable-learning", capitalRisk: "none", operation: "none", rcDecision: "not-required",
      protectedAssetsPreserved: true, independentReceiptAvailable: true, credentialRole: "posting", nextEligibleAt: null,
      evidenceSummary: "the settled no-capture runner preserves ZINGALPHA #1831, spends no Dust or RC, stops for presence challenges, and reconciles authoritative before/after session state",
    },
    {
      game: "hashkings", action: "preserve-parked-custody", executableNow: false,
      benefitClass: "durable-learning", capitalRisk: "none", operation: "none", rcDecision: "not-required",
      evidence: hashkings ? "true" : "neither", protectedAssetsPreserved: hashkings?.state?.hkfarmNfts?.disposition === "preserved-in-wallet",
      independentReceiptAvailable: true, credentialRole: "none", nextEligibleAt: null,
      evidenceSummary: hashkings ? `${hashkings.domainDisposition} game domain; current account has ${hashkings.state?.hkfarmNfts?.count ?? 0} HKFARM NFTs and no admitted recovery transition`
        : `HashKings observation unavailable: ${lookup.hashkings.error}`,
    },
    {
      game: "splinterlands", action: "manual-only-inventory-review", evidence: splinterlands ? "true" : "neither", executableNow: false,
      benefitClass: "durable-learning", capitalRisk: "none", operation: "none", rcDecision: "not-required",
      protectedAssetsPreserved: true, independentReceiptAvailable: true, credentialRole: "none", nextEligibleAt: null,
      evidenceSummary: splinterlands ? `current policy remains manual-only; ${splinterlands.collection.total} cards, ${splinterlands.collection.modernOwnedUndelegated} modern owned undelegated, ${splinterlands.player.energy} energy`
        : `Splinterlands observation unavailable: ${lookup.splinterlands.error}`,
    },
  ];
  const plan = rankGameOpportunities({ observedAt, candidates });
  const splinterlandsSummary = splinterlands === null ? null : Object.freeze({ observedAt: splinterlands.observedAt, player: splinterlands.player,
    collection: splinterlands.collection, policyMode: splinterlands.operatorPolicy.mode,
    queueSubmitted: splinterlands.admission.queueSubmitted });
  return Object.freeze({ ...plan, observations: Object.freeze({ dcity, dcrops, hashkings, holozingRewards,
    splinterlands: splinterlandsSummary, terracore, terracoreExit,
    unavailable: Object.freeze(observations.filter((entry) => entry.error !== null).map(({ game, error }) => Object.freeze({ game, error }))) }),
    credentialAccess: false, chainMutation: false });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { process.stdout.write(`${JSON.stringify(await observe(), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}

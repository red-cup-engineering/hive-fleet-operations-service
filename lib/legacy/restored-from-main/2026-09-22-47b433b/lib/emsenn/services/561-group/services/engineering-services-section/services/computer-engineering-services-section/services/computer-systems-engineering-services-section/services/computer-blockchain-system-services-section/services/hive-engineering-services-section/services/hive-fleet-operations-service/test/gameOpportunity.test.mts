import assert from "node:assert/strict";
import test from "node:test";

import { rankGameOpportunities, type GameOpportunityCandidate } from "../src/core/gameOpportunity.mts";
import { parseOptions } from "../scripts/game-opportunity-cycle.mjs";

const base: GameOpportunityCandidate = {
  game: "terracore", action: "claim-raid-exposed-scrap", evidence: "true", executableNow: true,
  benefitClass: "treasury-protection", capitalRisk: "none", operation: "custom_json_operation",
  rcDecision: "wait-for-rc-regeneration", protectedAssetsPreserved: true, independentReceiptAvailable: true,
  credentialRole: "posting", nextEligibleAt: "2026-07-22T15:38:04.451Z",
  evidenceSummary: "two balance providers and one authoritative game source support the exact claim",
  treasuryFloor: { quantity: "0.00131330", counterSymbol: "SWAP.HIVE" },
};
const { treasuryFloor: _treasuryFloor, ...baseWithoutTreasuryFloor } = base;

test("cross-game admission selects the only executable safe action without scalarizing units", () => {
  const plan = rankGameOpportunities({ observedAt: "2026-07-22T10:45:55.451Z", candidates: [
    base,
    { ...base, game: "dcrops", action: "wait", benefitClass: "productive-state", executableNow: false,
      credentialRole: "active", nextEligibleAt: "2026-07-24T12:30:26.000Z", evidenceSummary: "the Artichoke is growing" },
    { ...baseWithoutTreasuryFloor, game: "holozing-wilds", action: "bounded-no-capture-session", benefitClass: "resettable-learning",
      operation: "none", rcDecision: "not-required", credentialRole: "posting", nextEligibleAt: null,
      evidenceSummary: "no-capture alpha play preserves the protected vial" },
  ] });
  assert.equal(plan.decision, "execute-one");
  assert.deepEqual(plan.selected, { game: "holozing-wilds", action: "bounded-no-capture-session" });
  assert.equal(plan.ranked.find((candidate) => candidate.game === "terracore")?.refusal, "resource-credit-reserve-not-ready");
  assert.match(plan.formulae.noScalarization, /never added/u);
});

test("treasury protection dominates learning only after every hard gate is satisfied", () => {
  const ready = { ...base, rcDecision: "ready" as const, nextEligibleAt: "2026-07-22T10:45:55.451Z" };
  const learning = { ...baseWithoutTreasuryFloor, game: "holozing-wilds", action: "bounded-no-capture-session", benefitClass: "resettable-learning" as const,
    operation: "none" as const, rcDecision: "not-required" as const, nextEligibleAt: null };
  const plan = rankGameOpportunities({ observedAt: "2026-07-22T10:45:55.451Z", candidates: [learning, ready] });
  assert.deepEqual(plan.selected, { game: "terracore", action: "claim-raid-exposed-scrap" });
});

test("a productive no-capital reward claim dominates a repeatable learning session while gated recovery remains refused", () => {
  const plan = rankGameOpportunities({ observedAt: "2026-07-22T12:45:00.000Z", candidates: [
    base,
    { ...baseWithoutTreasuryFloor, game: "holozing-rewards", action: "claim-pending-zing", benefitClass: "productive-state",
      operation: "none", rcDecision: "not-required", credentialRole: "posting", nextEligibleAt: null,
      evidenceSummary: "pending ZING becomes on-chain stake while Alpha Vial #1831 remains unopened" },
    { ...baseWithoutTreasuryFloor, game: "holozing-wilds", action: "bounded-no-capture-session", benefitClass: "resettable-learning",
      operation: "none", rcDecision: "not-required", credentialRole: "posting", nextEligibleAt: null,
      evidenceSummary: "repeatable no-capture learning" },
  ] });
  assert.deepEqual(plan.selected, { game: "holozing-rewards", action: "claim-pending-zing" });
  assert.equal(plan.ranked.find((candidate) => candidate.game === "terracore")?.refusal, "resource-credit-reserve-not-ready");
});

test("FOUR contradiction, unknown risk, missing settlement, and vial uncertainty all fail closed", () => {
  const cases: readonly [Partial<GameOpportunityCandidate>, string][] = [
    [{ evidence: "both" }, "evidence-contested"],
    [{ capitalRisk: "unknown" }, "capital-risk-unknown"],
    [{ independentReceiptAvailable: false }, "independent-settlement-unavailable"],
    [{ protectedAssetsPreserved: false }, "protected-asset-invariant-not-proven"],
  ];
  for (const [change, expected] of cases) {
    const plan = rankGameOpportunities({ observedAt: "2026-07-22T10:45:55.451Z", candidates: [{ ...base, rcDecision: "ready", ...change }] });
    assert.equal(plan.decision, "wait");
    assert.equal(plan.ranked[0]?.refusal, expected);
  }
});

test("the cross-game planner has no credential, arbitrary-target, or execution surface", () => {
  assert.deepEqual(parseOptions([]), {});
  assert.throws(() => parseOptions(["--key-file", "/private/posting.wif"]), /unknown argument/u);
  assert.throws(() => parseOptions(["--execute-one"]), /unknown argument/u);
  assert.throws(() => parseOptions(["--game", "splinterlands"]), /unknown argument/u);
});

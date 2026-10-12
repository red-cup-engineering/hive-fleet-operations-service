import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CAPITAL_REQUEST_SCHEMA,
  HiveCapitalAllocationRefusal,
  admitHiveCapitalAllocation,
} from "../src/core/capitalAllocation.mjs";

const NOW = new Date("2026-07-22T18:00:20.000Z");
const PLAN_A = `ni:///sha-256;${"A".repeat(43)}`;
const PLAN_B = `ni:///sha-256;${"Q".repeat(43)}`;

function request(overrides = {}) {
  return {
    schema: CAPITAL_REQUEST_SCHEMA,
    requestedBy: "urn:office:agrodao:treasury-steward",
    observationId: "ni:///sha-256;fleet-observation",
    observedAt: "2026-07-22T18:00:00.000Z",
    expiresAt: "2026-07-22T18:04:00.000Z",
    inventory: [
      { assetId: "swap-hive", symbol: "SWAP.HIVE", custodyAccount: "help-fund", units: "100000000", precision: 8 },
      { assetId: "dec", symbol: "DEC", custodyAccount: "help-fund", units: "500000", precision: 3 },
      { assetId: "holozing-alpha-vial", symbol: "ALPHA_VIAL", custodyAccount: "michael561", units: "1", precision: 0 },
    ],
    arbitrage: {
      enterprise: "urn:ame:sigmund-hive-arbitrage-enterprise",
      account: "sigmund-vexler",
      planDigest: PLAN_A,
      reserve: [{ assetId: "swap-hive", units: "60000000", reason: "fund exact admitted cross-venue cycles" }],
    },
    liquidity: {
      enterprise: "urn:ame:help-hive-liquidity-enterprise",
      account: "help-fund",
      planDigest: PLAN_B,
      minimumLiquid: [
        { assetId: "swap-hive", units: "10000000", reason: "merchant and LP recall reserve" },
        { assetId: "dec", units: "0", reason: "no separate DEC operating requirement" },
      ],
      uses: [
        { assetId: "swap-hive", units: "30000000", pool: "SWAP.HIVE:DEC" },
        { assetId: "dec", units: "500000", pool: "SWAP.HIVE:DEC" },
      ],
    },
    ...overrides,
  };
}

function refusal(code, fn) {
  assert.throws(fn, (error) => error instanceof HiveCapitalAllocationRefusal && error.code === code);
}

test("Sigmund receives first claim and HELP receives only the derived surplus", () => {
  const decision = admitHiveCapitalAllocation(request(), NOW);
  const swap = decision.allocations.find(({ assetId }) => assetId === "swap-hive");
  assert.deepEqual(
    { reserve: swap.arbitrageReserveUnits, release: swap.releasedSurplusUnits, help: swap.helpLiquidityUnits, idle: swap.idleReleasedUnits },
    { reserve: "60000000", release: "40000000", help: "30000000", idle: "10000000" },
  );
  assert.equal(decision.authorizations.arbitrage.account, "sigmund-vexler");
  assert.deepEqual(decision.authorizations.arbitrage.actions, ["trade", "trade-bundle"]);
  assert.equal(decision.authorizations.liquidity.account, "help-fund");
  assert.deepEqual(decision.authorizations.liquidity.actions, ["lp"]);
  assert.equal(decision.authorizations.liquidity.releaseId, decision.surplusRelease.releaseId);
  assert.equal(decision.executionAuthority, false);
});

test("the arbitrage enterprise may address capital through its actual custody account", () => {
  const input = request();
  input.inventory = input.inventory.map((line) => line.assetId === "swap-hive"
    ? { ...line, custodyAccount: "michael561" }
    : line);
  input.arbitrage = { ...input.arbitrage, account: "michael561" };
  input.liquidity = { ...input.liquidity, uses: [], minimumLiquid: [] };
  const decision = admitHiveCapitalAllocation(input, NOW);
  assert.equal(decision.authorizations.arbitrage.account, "michael561");
  assert.equal(decision.capitalPriority[0], "michael561:arbitrage");
});

test("the Alpha Vial is hard-protected even when inventory forgets the flag", () => {
  const decision = admitHiveCapitalAllocation(request(), NOW);
  const vial = decision.allocations.find(({ assetId }) => assetId === "holozing-alpha-vial");
  assert.equal(vial.protected, true);
  assert.equal(vial.releasedSurplusUnits, "0");
  assert.equal(vial.helpLiquidityUnits, "0");
  const bad = request();
  bad.liquidity = { ...bad.liquidity, uses: [...bad.liquidity.uses, { assetId: "holozing-alpha-vial", units: "1", pool: "ALPHA_VIAL:SWAP.HIVE" }] };
  refusal("protected-asset", () => admitHiveCapitalAllocation(bad, NOW));
});

test("HELP cannot consume one atom beyond released surplus after its operating reserve", () => {
  const bad = request();
  bad.liquidity = {
    ...bad.liquidity,
    uses: bad.liquidity.uses.map((line) => line.assetId === "swap-hive" ? { ...line, units: "30000001" } : line),
  };
  refusal("release-exceeded", () => admitHiveCapitalAllocation(bad, NOW));
});

test("HELP cannot pool without both exact legs and a merchant-recall reserve", () => {
  const noReserve = request();
  noReserve.liquidity = { ...noReserve.liquidity, minimumLiquid: noReserve.liquidity.minimumLiquid.filter((line) => line.assetId !== "swap-hive") };
  refusal("missing-help-reserve", () => admitHiveCapitalAllocation(noReserve, NOW));

  const oneLeg = request();
  oneLeg.liquidity = { ...oneLeg.liquidity, uses: oneLeg.liquidity.uses.filter((line) => line.assetId !== "dec") };
  refusal("incomplete-pool-legs", () => admitHiveCapitalAllocation(oneLeg, NOW));
});

test("HELP cannot treat another account's unsettled balance as pool capital", () => {
  const bad = request();
  bad.inventory = bad.inventory.map((line) => line.assetId === "dec" ? { ...line, custodyAccount: "sigmund-vexler" } : line);
  refusal("unsettled-custody", () => admitHiveCapitalAllocation(bad, NOW));
});

test("bad incumbent paths and stale evidence fail closed", () => {
  refusal("wrong-authority", () => admitHiveCapitalAllocation(request({ requestedBy: "urn:office:union:chief-executive-officer" }), NOW));
  refusal("wrong-authority", () => admitHiveCapitalAllocation(request({ requestedBy: "urn:ame:aagaard" }), NOW));
  refusal("stale-inventory", () => admitHiveCapitalAllocation(request({ observedAt: "2026-07-22T17:59:00.000Z" }), NOW));
});

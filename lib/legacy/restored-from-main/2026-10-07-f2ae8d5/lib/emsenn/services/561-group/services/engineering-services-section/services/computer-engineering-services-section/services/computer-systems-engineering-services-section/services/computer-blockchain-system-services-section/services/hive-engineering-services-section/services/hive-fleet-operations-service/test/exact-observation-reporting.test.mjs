import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { projectHiveFleetObservation as projectObservation } from "@red-cup-engineering/hive-fleet-observation-service";
import { collectAagaardCivicState } from "../src/collect-civic-state.mjs";
import { recordClaim } from "../src/core/journal.mjs";
const at = "2026-10-06T00:00:00.000Z";
test("exact holdings survive journal, observation and civic reporting; missing holdings never become zero", async () => {
  const root = await mkdtemp(join(tmpdir(), "rowan-hive-exact-observation-"));
  const tick = { ts: at, accounts: [
    { account: "alpha", trading: { hive: "12345678901234567890.001 HIVE", hbd: "1.000 HBD" } },
    { account: "beta", trading: { hive: "0.002 HIVE" } },
  ] };
  try {
    await recordClaim(join(root, "data"), "aagaard.fleet-tick", at, tick);
    const observation = projectObservation(tick, "urn:test:source");
    assert.deepEqual(observation.aggregateLiquid, { hive: "12345678901234567890.003", hbd: null });
    const report = await collectAagaardCivicState({ root, period: "2026-10-06", recordedAt: at });
    const claim = report.object.claims.find((c) => c.claimId === "economy/liquid-hive-observed");
    assert.equal(claim.measurement.amount, "12345678901234567890.003");
    assert.equal(claim.economic.amount, claim.measurement.amount);
    assert.equal(report.object.claims.some((c) => c.claimId === "economy/liquid-hbd-observed"), false);
    assert.ok(claim.provenance.length);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("absent observations differ from an observed empty fleet", () => {
  assert.deepEqual(projectObservation({ ts: at }, "source").aggregateLiquid, { hive: null, hbd: null });
  assert.deepEqual(projectObservation({ ts: at, accounts: [] }, "source").aggregateLiquid, { hive: "0", hbd: "0" });
  assert.equal(projectObservation({ ts: at, accounts: [{ account: "alpha", trading: { hive: "1e9 HIVE" } }] }, "source").aggregateLiquid.hive, null);
});

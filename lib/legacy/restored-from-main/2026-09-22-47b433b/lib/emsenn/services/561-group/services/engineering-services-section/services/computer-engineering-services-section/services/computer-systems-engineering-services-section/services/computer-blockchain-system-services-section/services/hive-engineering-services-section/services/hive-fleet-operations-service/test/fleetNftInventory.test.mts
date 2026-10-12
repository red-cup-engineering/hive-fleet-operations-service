import assert from "node:assert/strict";
import test from "node:test";

import { certifyFleetNftInventory, type FleetNftProviderObservation } from "../src/core/fleetNftInventory.mts";

const registry = Object.freeze([
  Object.freeze({ symbol: "CITY", name: "dCITY NFT TOKEN", issuer: "gerber", circulatingSupply: "2096928" }),
  Object.freeze({ symbol: "ZINGALPHA", name: "Zing Alpha Vials", issuer: "poshtoken", circulatingSupply: "10000" }),
]);
const collections = Object.freeze([
  Object.freeze({ registry: registry[0]!, instances: Object.freeze([
    Object.freeze({ id: "1", account: "emsenn0", ownedBy: "u" as const, propertiesJson: "{\"name\":\"Bank\"}", lockedTokensJson: "{\"SIM\":\"20\"}", delegatedTo: null }),
    Object.freeze({ id: "2", account: "michael561", ownedBy: "u" as const, propertiesJson: "{}", lockedTokensJson: "{}", delegatedTo: null }),
  ]) }),
]);

function observation(provider: string, changed = false): FleetNftProviderObservation {
  return Object.freeze({ provider, status: "available", registry, collections: changed
    ? Object.freeze([{ ...collections[0]!, instances: Object.freeze([collections[0]!.instances[0]!]) }]) : collections });
}

test("two exact providers certify the complete registry and fleet-owned NFT aggregate", () => {
  const report = certifyFleetNftInventory({ observedAt: "2026-07-22T09:20:00.000Z", fleetAccounts: ["emsenn0", "michael561"],
    observations: [observation("https://one.example"), observation("https://two.example")] });
  assert.equal(report.status, "certified"); if (report.status !== "certified") return;
  assert.equal(report.registryCount, 2);
  assert.equal(report.totalOwnedInstances, 2);
  assert.deepEqual(report.byAccount, { emsenn0: 1, michael561: 1 });
  assert.equal(report.collections[0]?.lockedTokenRows, 1);
  assert.equal(report.credentialAccess, false);
});

test("provider contradiction suppresses the inventory rather than choosing a witness", () => {
  const report = certifyFleetNftInventory({ observedAt: "2026-07-22T09:20:00.000Z", fleetAccounts: ["emsenn0", "michael561"],
    observations: [observation("https://one.example"), observation("https://two.example", true)] });
  assert.equal(report.status, "uncertified");
  assert.equal(report.providerKnowledge.value, "both");
  assert.equal(report.collections, null);
});

test("foreign fleet custody and malformed registry identities fail closed", () => {
  const foreign = Object.freeze({ ...collections[0]!, instances: Object.freeze([{ ...collections[0]!.instances[0]!, account: "outsider" }]) });
  assert.throws(() => certifyFleetNftInventory({ observedAt: "2026-07-22T09:20:00.000Z", fleetAccounts: ["emsenn0"], observations: [
    { provider: "https://one.example", status: "available", registry, collections: [foreign] },
    { provider: "https://two.example", status: "available", registry, collections: [foreign] },
  ] }), /outside/u);
});

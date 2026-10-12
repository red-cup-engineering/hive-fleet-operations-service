import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readSettlementRecords, recordSettlementRecord } from "@emsenn/rwil-rdf-services/client";
import { startRwilProviderProcess } from "@emsenn/rwil-rdf-services/test-provider";

import { digest, run } from "../src/contract-fleet-observation.mjs";
import { HIVE_FLEET_CUSTODY_OBSERVATION_CONTRACT } from "../src/law.mjs";

const CONTEXT = "https://www.w3.org/ns/activitystreams";
const PROVIDER = "urn:ame:aagaard";
const BUYER = "urn:ame:agrodao";
const AT = "2026-07-18T21:00:00.000Z";
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
let rwil;
test.before(async () => { rwil = await startRwilProviderProcess(); });
test.after(async () => { await rwil.close(); });

function tick() {
  return { kind: "aagaard.fleet-tick", ts: "2026-07-18T05:42:36.779Z", running: true, live: true, enabled: ["voting", "trading"],
    accounts: [{ account: "alpha", voting: { votesPlanned: 1, votesBroadcast: 0, votesSkipped: 1, execution: { errors: 0 } },
      trading: { mode: "propose-only", hive: "2.500 HIVE", hbd: "0.250 HBD", tradesPlanned: 1, tradesExecuted: 0, lpPlanned: 2, lpExecuted: 0, savingsExecuted: false } },
    { account: "beta", voting: { votesPlanned: 0, votesBroadcast: 0, votesSkipped: 0, execution: { errors: 0 } },
      trading: { mode: "propose-only", hive: "1.000 HIVE", hbd: "0.750 HBD", tradesPlanned: 0, tradesExecuted: 0, lpPlanned: 0, lpExecuted: 0, savingsExecuted: false } }] };
}
function solicitation() {
  return { "@context": CONTEXT, id: "urn:test:solicitation", type: "Offer", actor: BUYER, target: PROVIDER,
    object: { type: "ServiceSolicitation", contract: HIVE_FLEET_CUSTODY_OBSERVATION_CONTRACT,
      request: { scope: "hive-wallet-fleet-custody", intendedUse: "AGRODAO Hive-scoped position disclosure" } } };
}
function acceptance(offer) {
  return { "@context": CONTEXT, id: "urn:test:acceptance", type: "Accept", actor: BUYER, target: PROVIDER,
    object: { type: "ServiceContract", law: HIVE_FLEET_CUSTODY_OBSERVATION_CONTRACT, offer,
      termsAcceptance: { termDigest: offer.object.termsDigest },
      capability: { type: "Capability", holder: PROVIDER, invocationTarget: PROVIDER, parentOffer: offer.id,
        attenuation: { sourceTickDigest: offer.object.sourceTickDigest }, capTP: { target: PROVIDER, method: "invoke-service" },
        allowedActions: ["invoke-service", "provider-local-rwil-evidence"] } } };
}
async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "aagaard-contract-test-")); const dataRoot = join(root, "data");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  await recordSettlementRecord({ agentUrl: rwil.agentCardUrl, root: dataRoot, nodeId: "aagaard", settlement: SETTLEMENT,
    actor: PROVIDER, category: "aagaard.fleet-tick", recordedAt: tick().ts, record: tick() });
  return { dataRoot, env: { AAGAARD_CONTRACT_DATA_ROOT: dataRoot, RWIL_RDF_AGENT: rwil.agentCardUrl } };
}

test("Aagaard returns one exact-law read-only fleet observation", async (t) => {
  const value = await fixture(t); const offer = await run(solicitation(), "solicit-service", AT, value.env);
  assert.equal(offer.type, "Offer"); assert.equal(offer.law, HIVE_FLEET_CUSTODY_OBSERVATION_CONTRACT);
  assert.equal(offer.object.requestDigest, digest(offer.object.request)); assert.equal(offer.object.terms.assetPaymentRequired, false);
  const result = await run(acceptance(offer), "invoke-service", AT, value.env);
  assert.equal(result.type, "Accept"); assert.equal(result.object.exchange.outcome, "completion");
  assert.deepEqual(result.object.exchange.observation.aggregateLiquid, { hive: 3.5, hbd: 1 });
  assert.equal(result.object.exchange.observation.chainMutation, false); assert.equal(result.object.exchange.observation.credentialAccess, false);
  assert.equal(result.object.receipt.customer, BUYER); assert.equal(result.object.receipt.assetSettlementClaimed, false);
  assert.equal(readSettlementRecords(value.dataRoot, "aagaard.fleet-observation-exchange").length, 1);
  assert.equal(readSettlementRecords(value.dataRoot, "aagaard.book-entry").length, 0);
});

test("Aagaard refuses when the settled tick drifts after its offer", async (t) => {
  const value = await fixture(t); const offer = await run(solicitation(), "solicit-service", AT, value.env);
  const changed = tick(); changed.ts = "2026-07-18T05:43:00.000Z";
  await recordSettlementRecord({ agentUrl: rwil.agentCardUrl, root: value.dataRoot, nodeId: "aagaard", settlement: SETTLEMENT,
    actor: PROVIDER, category: "aagaard.fleet-tick", recordedAt: changed.ts, record: changed });
  const result = await run(acceptance(offer), "invoke-service", AT, value.env);
  assert.equal(result.type, "Reject"); assert.match(result.object.reason, /changed after the offer/);
  assert.equal(result.object.prohibitedEffectsPerformed, false);
});

test("Aagaard refuses a capability that grants wallet authority", async (t) => {
  const value = await fixture(t); const offer = await run(solicitation(), "solicit-service", AT, value.env);
  const accept = acceptance(offer); accept.object.capability.allowedActions.push("move-assets");
  const result = await run(accept, "invoke-service", AT, value.env);
  assert.equal(result.type, "Reject"); assert.match(result.object.reason, /forbidden wallet authority/);
});

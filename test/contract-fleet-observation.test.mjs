import assert from "node:assert/strict";
import test from "node:test";

import { querySettlementRecords, recordSettlementRecord } from "@red-cup-engineering/witness-journal-document-service";
import { startWitnessJournalProviderProcess } from "@red-cup-engineering/witness-journal-document-service/test-provider";

import { digest, run } from "../src/contract-fleet-observation.mjs";
import { ACTIVITYSTREAMS_CONTEXT } from "@red-cup-engineering/activitypub-services-section/activitystreams";

const PROVIDER = "urn:ame:aagaard";
const BUYER = "urn:ame:agrodao";
const AT = "2026-07-18T21:00:00.000Z";
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
let journal;

test.before(async () => { journal = await startWitnessJournalProviderProcess(); });
test.after(async () => { await journal.close(); });

function tick() {
  return { kind: "aagaard.fleet-tick", ts: "2026-07-18T05:42:36.779Z", running: true, live: true,
    enabled: ["voting", "trading"], accounts: [
      { account: "alpha", voting: { votesPlanned: 1, votesBroadcast: 0, votesSkipped: 1, execution: { errors: 0 } },
        trading: { mode: "propose-only", hive: "2.500 HIVE", hbd: "0.250 HBD", tradesPlanned: 1,
          tradesExecuted: 0, lpPlanned: 2, lpExecuted: 0, savingsExecuted: false } },
      { account: "beta", voting: { votesPlanned: 0, votesBroadcast: 0, votesSkipped: 0, execution: { errors: 0 } },
        trading: { mode: "propose-only", hive: "1.000 HIVE", hbd: "0.750 HBD", tradesPlanned: 0,
          tradesExecuted: 0, lpPlanned: 0, lpExecuted: 0, savingsExecuted: false } },
    ] };
}

function solicitation() {
  const body = { "@context": ACTIVITYSTREAMS_CONTEXT, type: "Offer", actor: BUYER, target: PROVIDER,
    object: { type: "ServiceSolicitation",
      request: { scope: "hive-wallet-fleet-custody", intendedUse: "AGRODAO Hive-scoped position disclosure" } },
    published: AT };
  return { id: "urn:test:solicitation", ...body };
}

function acceptance(offer) {
  return { "@context": ACTIVITYSTREAMS_CONTEXT, id: "urn:test:acceptance", type: "Accept", actor: BUYER, target: PROVIDER,
    object: { type: "ServiceContract", offer,
      termsAcceptance: { termDigest: offer.object.termsDigest, acceptedBy: BUYER },
      capability: { type: "Capability", holder: PROVIDER, invocationTarget: PROVIDER, parentOffer: offer.id,
        attenuation: { sourceTickDigest: offer.object.sourceTickDigest },
        capTP: { target: PROVIDER, method: "invoke-service" },
        allowedActions: ["invoke-service", "provider-local-witness-journal-evidence"] } }, published: AT };
}

async function fixture() {
  const env = { WITNESS_JOURNAL_RDF_AGENT: journal.agentCardUrl };
  await recordSettlementRecord({ agentUrl: journal.agentCardUrl, settlement: SETTLEMENT, actor: PROVIDER,
    category: "aagaard.fleet-tick", recordedAt: tick().ts, record: tick() });
  return env;
}

test("Aagaard returns one provider-authored read-only fleet observation", async () => {
  const env = await fixture();
  const offer = await run(solicitation(), "solicit-service", AT, env);
  assert.equal(offer.type, "Offer");
  assert.equal(offer.object.requestDigest, digest(offer.object.request));
  assert.equal(offer.object.terms.assetPaymentRequired, false);
  const result = await run(acceptance(offer), "invoke-service", AT, env);
  assert.equal(result.type, "Accept");
  assert.deepEqual(result.object.exchange.observation.aggregateLiquid, { hive: 3.5, hbd: 1 });
  assert.equal(result.object.exchange.observation.chainMutation, false);
  assert.equal(result.object.exchange.observation.credentialAccess, false);
  assert.equal(result.object.receipt.customer, BUYER);
  assert.equal(result.object.receipt.assetSettlementClaimed, false);
  assert.equal((await querySettlementRecords("aagaard.fleet-observation-exchange", { agentUrl: journal.agentCardUrl })).length, 1);
  assert.equal((await querySettlementRecords("aagaard.book-entry", { agentUrl: journal.agentCardUrl })).length, 0);
});

test("Aagaard refuses when the settled tick drifts after its offer", async () => {
  const env = await fixture();
  const offer = await run(solicitation(), "solicit-service", AT, env);
  const changed = tick(); changed.ts = "2026-07-18T05:43:00.000Z";
  await recordSettlementRecord({ agentUrl: journal.agentCardUrl, settlement: SETTLEMENT, actor: PROVIDER,
    category: "aagaard.fleet-tick", recordedAt: changed.ts, record: changed });
  const result = await run(acceptance(offer), "invoke-service", AT, env);
  assert.equal(result.type, "Reject");
  assert.match(result.object.reason, /changed after the offer/);
  assert.equal(result.object.prohibitedEffectsPerformed, false);
});

test("Aagaard refuses a capability that grants wallet authority", async () => {
  const env = await fixture();
  const offer = await run(solicitation(), "solicit-service", AT, env);
  const accept = acceptance(offer); accept.object.capability.allowedActions.push("move-assets");
  const result = await run(accept, "invoke-service", AT, env);
  assert.equal(result.type, "Reject");
  assert.match(result.object.reason, /forbidden wallet authority/);
});

test("Aagaard fails closed without its WitnessJournal provider", async () => {
  await assert.rejects(() => run(solicitation(), "solicit-service", AT, {}), /WITNESS_JOURNAL_RDF_AGENT/);
});

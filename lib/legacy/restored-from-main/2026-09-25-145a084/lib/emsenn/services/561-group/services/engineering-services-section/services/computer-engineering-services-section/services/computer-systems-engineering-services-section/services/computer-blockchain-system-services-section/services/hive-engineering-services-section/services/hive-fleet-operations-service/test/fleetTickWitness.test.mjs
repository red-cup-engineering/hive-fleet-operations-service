import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { querySettlementRecords } from "@red-cup-engineering/witness-journal-document-service";
import { startWitnessJournalProviderProcess } from "@red-cup-engineering/witness-journal-document-service/test-provider";
import { ensureStore, recordFleetTick } from "../src/core/core.adapter.mjs";
import { run as observeFleet } from "../src/contract-fleet-observation.mjs";
const AT = "2026-09-01T22:45:00.000Z";
const PROVIDER = "urn:ame:aagaard";
const CUSTOMER = "urn:ame:agrodao";
function tick() {
    return Object.freeze({
        kind: "aagaard.fleet-tick",
        ts: AT,
        running: true,
        live: false,
        enabled: Object.freeze([]),
        accounts: Object.freeze([]),
        dervish: null,
        witness: Object.freeze({
            rows: 0,
            uniqueWitnesses: 0,
            duplicateWitnesses: 0
        })
    });
}
test("a normal fleet tick becomes Aagaard's provider-readable WitnessJournal source", async (t)=>{
    const root = mkdtempSync(path.join(tmpdir(), "aagaard-fleet-tick-witness-"));
    t.after(()=>rmSync(root, {
            recursive: true,
            force: true
        }));
    const journal = await startWitnessJournalProviderProcess();
    t.after(async ()=>journal.close());
    const env = {
        WITNESS_JOURNAL_RDF_AGENT: journal.agentCardUrl
    };
    const store = ensureStore(root, {
        witnessJournalAgent: journal.agentCardUrl
    });
    await recordFleetTick(store, tick());
    assert.deepEqual(await querySettlementRecords("aagaard.fleet-tick", {
        agentUrl: journal.agentCardUrl
    }), [
        tick()
    ]);
    const solicitation = {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: "urn:test:fleet-tick-solicitation",
        type: "Offer",
        actor: CUSTOMER,
        target: PROVIDER,
        object: {
            type: "ServiceSolicitation",
            request: {
                scope: "hive-wallet-fleet-custody",
                intendedUse: "AGRODAO Hive-scoped position disclosure"
            }
        },
        published: AT
    };
    const offer = await observeFleet(solicitation, "solicit-service", AT, env);
    assert.equal(offer.type, "Offer");
    assert.equal(offer.object.sourceTickDigest.length > 0, true);
});
test("fleet tick recording fails closed without a WitnessJournal binding", async (t)=>{
    const root = mkdtempSync(path.join(tmpdir(), "aagaard-fleet-tick-unbound-"));
    t.after(()=>rmSync(root, {
            recursive: true,
            force: true
        }));
    await assert.rejects(()=>recordFleetTick(ensureStore(root, {
            witnessJournalAgent: "",
            witnessJournalRequired: true
        }), tick()), /WITNESS_JOURNAL_RDF_AGENT/);
});

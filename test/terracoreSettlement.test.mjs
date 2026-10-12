import assert from "node:assert/strict";
import test from "node:test";
import { readTerraCoreActionReceipts, recordTerraCoreActionReceipt } from "../src/core/terracoreSettlement.mjs";
test("TerraCore pending and recovered receipts project deterministic, linked events", async ()=>{
    const transactionId = "5".repeat(40);
    const pending = Object.freeze({
        kind: "aagaard.terracore-one-action-receipt",
        account: "michael561",
        transactionId,
        status: "settlement-pending",
        before: Object.freeze({
            liquidScrap: "113.48115280",
            player: Object.freeze({
                scrap: "21.55644444"
            })
        }),
        plan: Object.freeze({
            kind: "claim",
            amount: "21.55644444"
        })
    });
    const first = await recordTerraCoreActionReceipt("/tmp/not-used", pending, "2026-07-22T03:35:25.000Z");
    const duplicate = await recordTerraCoreActionReceipt("/tmp/not-used", pending, "2026-07-22T03:36:00.000Z");
    assert.equal(first.eventId, duplicate.eventId);
    const confirmed = await recordTerraCoreActionReceipt("/tmp/not-used", Object.freeze({
        ...pending,
        status: "claim-confirmed",
        claimedScrap: "21.56419852",
        after: Object.freeze({
            liquidScrap: "135.04535132",
            player: Object.freeze({
                scrap: "0.09107111"
            })
        }),
        recoveryOf: first.eventId
    }), "2026-07-22T03:35:40.000Z");
    assert.equal(confirmed.status, "claim-confirmed");
    assert.equal(confirmed.receipt.recoveryOf, first.eventId);
    assert.notEqual(confirmed.eventId, first.eventId);
    await assert.rejects(readTerraCoreActionReceipts("/tmp/not-used", transactionId), /chain-derived/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { tokenLiquidationEvent } from "../src/core/tokenLiquidationSettlement.mjs";
test("confirmed liquidation receipts project deterministically from the chain receipt", ()=>{
    const receipt = Object.freeze({
        kind: "aagaard.token-liquidation-receipt",
        status: "liquidated-confirmed",
        account: "michael561",
        symbol: "ARCHMAGE",
        transactionId: "a".repeat(40)
    });
    const first = tokenLiquidationEvent(receipt, "2026-07-22T04:00:00.000Z");
    const second = tokenLiquidationEvent(receipt, "2026-07-22T04:01:00.000Z");
    assert.equal(first.eventId, second.eventId);
});

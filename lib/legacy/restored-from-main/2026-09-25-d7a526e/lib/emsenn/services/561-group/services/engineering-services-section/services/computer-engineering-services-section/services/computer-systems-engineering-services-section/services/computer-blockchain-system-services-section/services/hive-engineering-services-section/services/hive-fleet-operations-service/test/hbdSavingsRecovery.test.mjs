import assert from "node:assert/strict";
import test from "node:test";
import { hbdSavingsRecoveryEvent } from "../src/core/hbdSavingsRecoverySettlement.mjs";
const request = {
    requestId: 108346161,
    from: "michael561",
    to: "michael561",
    amount: "16.298 HBD",
    memo: "aagaard:hbd-savings-exit:v1",
    completeAt: "2026-07-25T04:09:27.000Z"
};
function receipt(status) {
    const state = {
        account: "michael561",
        liquidHbd: status === "pending" ? "0.006 HBD" : "16.304 HBD",
        savingsHbd: "0.000 HBD",
        request: status === "pending" ? request : null,
        delivery: status === "delivered" ? {
            requestId: 108346161,
            from: "michael561",
            to: "michael561",
            amount: "16.298 HBD",
            memo: "aagaard:hbd-savings-exit:v1",
            historyIndex: 220999,
            block: 108400000,
            timestamp: "2026-07-25T04:09:30.000Z"
        } : null
    };
    return {
        kind: "aagaard.hbd-savings-recovery-observation",
        sourceExitEventId: "urn:aagaard:hbd-savings-exit:e-DK_l-iSSU2Bsfvsz6_nFbeUWt7ivM-QR6XbrBu_QU",
        account: "michael561",
        requestId: 108346161,
        amount: "16.298 HBD",
        completeAt: "2026-07-25T04:09:27.000Z",
        observedAt: "2026-07-22T14:55:00Z",
        status,
        state,
        providerKnowledge: {
            value: "true",
            stateDigests: [
                {
                    stateDigest: `sha256:${(status === "pending" ? "a" : "b").repeat(64)}`,
                    providers: [
                        "https://one.example",
                        "https://two.example"
                    ]
                }
            ]
        },
        credentialAccess: false,
        chainMutation: false
    };
}
test("recovery distinguishes a live request from exact virtual-operation delivery", ()=>{
    const pending = hbdSavingsRecoveryEvent(receipt("pending"));
    assert.equal(pending.status, "pending");
    assert.equal(pending.deliverySource, null);
    const delivered = hbdSavingsRecoveryEvent(receipt("delivered"));
    assert.equal(delivered.status, "delivered");
    assert.equal(delivered.deliverySource?.historyIndex, 220999);
    const bad = receipt("delivered");
    assert.throws(()=>hbdSavingsRecoveryEvent({
            ...bad,
            state: {
                ...bad.state,
                delivery: null
            }
        }), /fill_transfer_from_savings/u);
});
test("pending and delivered recovery observations project independently", ()=>{
    const first = hbdSavingsRecoveryEvent(receipt("pending"));
    const duplicate = hbdSavingsRecoveryEvent(receipt("pending"));
    const delivered = hbdSavingsRecoveryEvent(receipt("delivered"));
    assert.equal(first.eventId, duplicate.eventId);
    assert.notEqual(first.eventId, delivered.eventId);
});

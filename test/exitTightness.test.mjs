import assert from "node:assert/strict";
import test from "node:test";
import { certifyHiveEngineExit } from "../src/core/exitTightness.mjs";
const STATE = Object.freeze({
    symbol: "THIN",
    precision: 3,
    liquid: "10.000",
    stake: "2.000",
    delegationsOut: "1.000",
    pendingUnstake: "3.000",
    pendingUndelegations: "0.000",
    stakingEnabled: true,
    delegationEnabled: true,
    unstakingCooldownDays: 28,
    undelegationCooldownDays: 7,
    releaseTransactions: 4,
    bidBookComplete: true,
    bids: Object.freeze([
        Object.freeze({
            price: "1.00000000",
            quantity: "9.000",
            orderId: "second"
        }),
        Object.freeze({
            price: "2.00000000",
            quantity: "1.000",
            orderId: "first"
        })
    ])
});
function observations(right = STATE) {
    return Object.freeze([
        Object.freeze({
            provider: "https://one.example/rpc/contracts",
            observedAt: "2026-07-22T00:00:00.000Z",
            status: "available",
            state: STATE
        }),
        Object.freeze({
            provider: "https://two.example/rpc/contracts",
            observedAt: "2026-07-22T00:00:01.000Z",
            status: "available",
            state: right
        })
    ]);
}
test("certified exit integrates every displayed bid level instead of marking the whole position at the best bid", ()=>{
    const report = certifyHiveEngineExit({
        account: "michael561",
        requestedQuantity: "10",
        observations: observations()
    });
    assert.equal(report.status, "certified");
    if (report.status !== "certified") return;
    assert.equal(report.providerKnowledge.value, "true");
    assert.equal(report.valuation.completeExit, true);
    assert.equal(report.valuation.grossDepthProceeds, "11.00000000");
    assert.equal(report.valuation.topQuoteMark, "20.00000000");
    assert.equal(report.valuation.topQuoteMarkGap, "9.00000000");
    assert.equal(report.valuation.topQuoteMarkGapBps, 4500);
    assert.equal(report.valuation.volumeWeightedAverageBid, "1.10000000");
    assert.equal(report.valuation.floorBid, "1.00000000");
    assert.equal(report.valuation.levelsConsumed, 2);
    assert.deepEqual(report.utility, {
        stakingEnabled: true,
        delegationEnabled: true,
        unstakingCooldownDays: 28,
        undelegationCooldownDays: 7,
        releaseTransactions: 4
    });
});
test("visible depth shortfall remains explicit and is never called a full exit value", ()=>{
    const thin = Object.freeze({
        ...STATE,
        bids: Object.freeze([
            Object.freeze({
                price: "2",
                quantity: "5",
                orderId: "only"
            })
        ])
    });
    const report = certifyHiveEngineExit({
        account: "michael561",
        requestedQuantity: "10.000",
        observations: observations(thin).map((entry)=>({
                ...entry,
                state: thin
            }))
    });
    assert.equal(report.status, "certified");
    if (report.status !== "certified") return;
    assert.equal(report.valuation.completeExit, false);
    assert.equal(report.valuation.coverageBps, 5000);
    assert.equal(report.valuation.coveredQuantity, "5.000");
    assert.equal(report.valuation.uncoveredQuantity, "5.000");
});
test("provider disagreement is FOUR both and suppresses valuation", ()=>{
    const contested = Object.freeze({
        ...STATE,
        liquid: "9.000"
    });
    const report = certifyHiveEngineExit({
        account: "michael561",
        requestedQuantity: "9",
        observations: observations(contested)
    });
    assert.equal(report.status, "uncertified");
    assert.equal(report.providerKnowledge.value, "both");
    assert.equal(report.refusal, "provider-state-contested");
    assert.equal(report.valuation, null);
});
test("one unavailable provider leaves FOUR neither, while a truncated book refuses a number", ()=>{
    const insufficient = certifyHiveEngineExit({
        account: "michael561",
        requestedQuantity: "10",
        observations: [
            observations()[0],
            {
                provider: "https://two.example/rpc/contracts",
                observedAt: "2026-07-22T00:00:01.000Z",
                status: "unavailable",
                problem: "timeout"
            }
        ]
    });
    assert.equal(insufficient.providerKnowledge.value, "neither");
    assert.equal(insufficient.status, "uncertified");
    const truncated = Object.freeze({
        ...STATE,
        bidBookComplete: false
    });
    const report = certifyHiveEngineExit({
        account: "michael561",
        requestedQuantity: "10",
        observations: observations(truncated).map((entry)=>({
                ...entry,
                state: truncated
            }))
    });
    assert.equal(report.status, "uncertified");
    assert.equal(report.refusal, "bid-book-page-not-exhausted");
});
test("immediate-exit certification cannot spend locked inventory", ()=>{
    const report = certifyHiveEngineExit({
        account: "michael561",
        requestedQuantity: "10.001",
        observations: observations()
    });
    assert.equal(report.status, "uncertified");
    assert.equal(report.refusal, "requested-quantity-exceeds-immediately-sellable-liquid-balance");
});

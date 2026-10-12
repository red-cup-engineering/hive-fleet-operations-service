import assert from "node:assert/strict";
import test from "node:test";
import { sizeExactPoolCycle } from "../src/analysis/exactPoolCycle.mjs";
import { certifyPoolCycleAssay } from "../src/core/poolCycleAssay.mjs";
import { parseOptions } from "../scripts/exact-pool-cycle-assay.mjs";
const profitable = Object.freeze({
    initialBalance: "10.000",
    initialPrecision: 3,
    maximumInitial: "10.000",
    minimumProfitInitial: "0.100",
    minimumEdgeBps: 50,
    perPoolSlippageBps: 25,
    pools: Object.freeze([
        Object.freeze({
            pair: "A:B",
            inputSymbol: "A",
            outputSymbol: "B",
            reserveIn: "1000.000",
            reserveOut: "1100.000",
            inputPrecision: 3,
            outputPrecision: 3,
            feeBps: 25
        }),
        Object.freeze({
            pair: "B:C",
            inputSymbol: "B",
            outputSymbol: "C",
            reserveIn: "1000.000",
            reserveOut: "1100.000",
            inputPrecision: 3,
            outputPrecision: 3,
            feeBps: 25
        }),
        Object.freeze({
            pair: "A:C",
            inputSymbol: "C",
            outputSymbol: "A",
            reserveIn: "1000.000",
            reserveOut: "1100.000",
            inputPrecision: 3,
            outputPrecision: 3,
            feeBps: 25
        })
    ])
});
test("three exact pool minima compose into a positive closed-cycle bound", ()=>{
    const result = sizeExactPoolCycle(profitable);
    assert.equal(result.admitted, true);
    if (!result.admitted) return;
    assert.equal(result.quote.hops.length, 3);
    assert.equal(result.quote.policyAdmitted, true);
    assert.ok(result.quote.finalMinimumOutput > result.quote.input);
    assert.equal(result.quote.executionAdmissible, false);
    assert.ok(result.quote.evidenceGaps.includes("sequential-pool-actions-can-settle-partially"));
});
test("pool-cycle sizing refuses loss, route drift, precision drift, and weak policy surplus", ()=>{
    const loss = sizeExactPoolCycle({
        ...profitable,
        pools: profitable.pools.map((pool)=>({
                ...pool,
                reserveOut: "900.000"
            }))
    });
    assert.equal(loss.admitted, false);
    assert.equal(sizeExactPoolCycle({
        ...profitable,
        pools: [
            {
                ...profitable.pools[0],
                outputSymbol: "X"
            },
            ...profitable.pools.slice(1)
        ]
    }).admitted, false);
    assert.equal(sizeExactPoolCycle({
        ...profitable,
        pools: [
            profitable.pools[0],
            {
                ...profitable.pools[1],
                inputPrecision: 4
            },
            profitable.pools[2]
        ]
    }).admitted, false);
    const weak = sizeExactPoolCycle({
        ...profitable,
        minimumProfitInitial: "9.000"
    });
    assert.equal(weak.admitted, true);
    if (weak.admitted) assert.equal(weak.quote.policyAdmitted, false);
    const tooLarge = sizeExactPoolCycle({
        ...profitable,
        initialPrecision: 6,
        initialBalance: "10.000000",
        maximumInitial: "10.000000",
        minimumProfitInitial: "0.100000",
        pools: profitable.pools.map((pool)=>({
                ...pool,
                inputPrecision: 6,
                outputPrecision: 6
            }))
    });
    assert.equal(tooLarge.admitted, false);
    if (!tooLarge.admitted) assert.match(tooLarge.reason, /integer-unit certification bound/u);
});
test("FOUR provider contradiction and insufficiency suppress the pool-cycle result", ()=>{
    const base = {
        observedAt: "2026-07-22T11:15:00Z",
        account: "emsenn0",
        initialSymbol: "A"
    };
    const trueState = certifyPoolCycleAssay({
        ...base,
        observations: [
            {
                provider: "one",
                status: "available",
                state: profitable
            },
            {
                provider: "two",
                status: "available",
                state: profitable
            }
        ]
    });
    assert.equal(trueState.status, "certified");
    const both = certifyPoolCycleAssay({
        ...base,
        observations: [
            {
                provider: "one",
                status: "available",
                state: profitable
            },
            {
                provider: "two",
                status: "available",
                state: {
                    ...profitable,
                    initialBalance: "9.000"
                }
            }
        ]
    });
    assert.equal(both.status, "uncertified");
    assert.equal(both.providerKnowledge.value, "both");
    const neither = certifyPoolCycleAssay({
        ...base,
        observations: [
            {
                provider: "one",
                status: "available",
                state: profitable
            },
            {
                provider: "two",
                status: "unavailable",
                problem: "503"
            }
        ]
    });
    assert.equal(neither.providerKnowledge.value, "neither");
});
test("live cycle assay exposes no credential, target, or execution arguments", ()=>{
    assert.deepEqual(parseOptions([]), {});
    assert.throws(()=>parseOptions([
            "--execute-one"
        ]), /unknown argument/u);
    assert.throws(()=>parseOptions([
            "--account",
            "other"
        ]), /unknown argument/u);
});

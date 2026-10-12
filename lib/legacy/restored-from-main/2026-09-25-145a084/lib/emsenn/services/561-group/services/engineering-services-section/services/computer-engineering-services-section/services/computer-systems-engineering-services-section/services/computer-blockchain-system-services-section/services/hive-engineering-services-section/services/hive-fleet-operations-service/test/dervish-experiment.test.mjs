import test from "node:test";
import assert from "node:assert/strict";
import { DERVISH_LENSES, buildDervishTrialObservation, dervishBoundaryStepForPair, makeSixWalletRoster, readDervishScheduleStep } from "../src/core/dervishExperiment.mjs";
const roster = makeSixWalletRoster([
    "phase-zero",
    "phase-one",
    "phase-two",
    "phase-three",
    "phase-four",
    "phase-five"
]);
test("steps zero through twenty-nine cover every five-by-six pair exactly once", ()=>{
    const coordinates = Array.from({
        length: 30
    }, (_, step)=>readDervishScheduleStep(step, roster));
    const pairs = coordinates.map((coordinate)=>`${coordinate.site}:${coordinate.phase}`);
    assert.equal(new Set(pairs).size, 30);
    assert.deepEqual(new Set(coordinates.map((coordinate)=>coordinate.site)), new Set([
        0,
        1,
        2,
        3,
        4
    ]));
    assert.deepEqual(new Set(coordinates.map((coordinate)=>coordinate.phase)), new Set([
        0,
        1,
        2,
        3,
        4,
        5
    ]));
    assert.ok(coordinates.every((coordinate)=>coordinate.lens === DERVISH_LENSES[coordinate.site]));
    assert.ok(coordinates.every((coordinate)=>coordinate.account === roster[coordinate.phase]));
});
test("step thirty closes the finite schedule and starts the next cycle", ()=>{
    const zero = readDervishScheduleStep(0, roster);
    const thirty = readDervishScheduleStep(30, roster);
    assert.equal(zero.cycle, 0);
    assert.equal(thirty.cycle, 1);
    assert.equal(thirty.boundaryStep, zero.boundaryStep);
    assert.equal(thirty.site, zero.site);
    assert.equal(thirty.phase, zero.phase);
    assert.equal(thirty.lens, zero.lens);
    assert.equal(thirty.account, zero.account);
});
test("one account never receives the same lens twice before closure", ()=>{
    const byAccount = new Map();
    for(let step = 0; step < 30; step += 1){
        const coordinate = readDervishScheduleStep(step, roster);
        const lenses = byAccount.get(coordinate.account) ?? new Set();
        assert.equal(lenses.has(coordinate.lens.id), false);
        lenses.add(coordinate.lens.id);
        byAccount.set(coordinate.account, lenses);
    }
    assert.equal(byAccount.size, 6);
    assert.ok([
        ...byAccount.values()
    ].every((lenses)=>lenses.size === 5));
});
test("the explicit CRT witness realizes each requested site and phase", ()=>{
    for(let site = 0; site < 5; site += 1){
        for(let phase = 0; phase < 6; phase += 1){
            const step = dervishBoundaryStepForPair(site, phase);
            const coordinate = readDervishScheduleStep(step, roster);
            assert.equal(coordinate.site, site);
            assert.equal(coordinate.phase, phase);
        }
    }
});
test("roster admission preserves the per-account separation premise", ()=>{
    assert.throws(()=>makeSixWalletRoster([
            "a",
            "b",
            "c",
            "d",
            "e"
        ]), /exactly six/);
    assert.throws(()=>makeSixWalletRoster([
            "a",
            "b",
            "c",
            "d",
            "e",
            "a"
        ]), /distinct/);
});
test("coupled observations keep monetary and causal claims honest", ()=>{
    const coordinate = readDervishScheduleStep(7, roster);
    const prediction = Object.freeze({
        curationVoteLotSchema: "aagaard.curation-vote-lot.v1",
        event: "prediction-recorded",
        predictionId: "urn:aagaard:curation-prediction:one",
        recordedAt: "2026-07-20T00:00:00.000Z",
        account: coordinate.account,
        author: "author",
        permlink: "post",
        vote: Object.freeze({
            weightBps: 1000,
            txId: "tx-1"
        }),
        prediction: Object.freeze({
            signal: 1.5,
            unit: "aagaard.curation-strategy-signal.v1",
            rewardVests: null
        })
    });
    const settlement = Object.freeze({
        curationVoteLotSchema: "aagaard.curation-vote-lot.v1",
        event: "settlement-observed",
        recordedAt: "2026-07-20T00:00:00.000Z",
        source: Object.freeze({
            sourceId: "urn:hive:curation-reward:one",
            account: coordinate.account,
            historyIndex: 10,
            block: 100,
            operationIndex: 2,
            timestamp: "2026-07-19T23:59:59.000Z",
            author: "earlier-author",
            permlink: "earlier-post",
            reward: Object.freeze({
                amount: "1.250000",
                asset: "VESTS"
            }),
            payoutMustBeClaimed: true
        }),
        matchedPredictionId: "urn:aagaard:curation-prediction:earlier",
        matchedPredictionSignal: 0.75,
        valuation: Object.freeze({
            hbd: null,
            reason: "no-admitted-vests-to-hbd-valuation"
        })
    });
    const observation = buildDervishTrialObservation({
        coordinate,
        observedAt: "2026-07-20T00:00:00.000Z",
        votingReceipts: Object.freeze([
            Object.freeze({
                lane: "voting",
                action: "vote",
                target: "author/post",
                status: "broadcast",
                txId: "tx-1"
            }),
            Object.freeze({
                lane: "voting",
                action: "vote",
                target: "other/post",
                status: "broadcast",
                txId: "tx-2"
            })
        ]),
        curationPredictions: Object.freeze([
            prediction
        ]),
        curationSettlements: Object.freeze([
            settlement
        ]),
        tradingReceipts: Object.freeze([
            Object.freeze({
                lane: "trading",
                action: "trade-bundle",
                target: "bundle-one",
                status: "broadcast",
                txId: "market-tx-1",
                economicEffect: Object.freeze({
                    status: "confirmed",
                    source: "hive-engine.getTransactionInfo",
                    reference: "market-tx-1",
                    confirmedLegs: 2,
                    expectedLegs: 2,
                    realizedPnlSwapHive: 0.1
                })
            })
        ])
    });
    assert.equal(observation.attention.votes[0]?.execution.actualVoteCast, true);
    assert.equal(observation.attention.votes[0]?.curationSettlement.status, "pending");
    assert.equal(observation.attention.votes[0]?.curationSettlement.predictionId, prediction.predictionId);
    assert.equal(observation.attention.votes[1]?.curationSettlement.status, "broadcast-without-prediction-link");
    assert.equal(observation.attention.settlements[0]?.status, "matched");
    assert.equal(observation.attention.settlements[0]?.rewardVests?.amount, "1.250000");
    assert.equal(observation.market.execution.status, "confirmed-complete-round-trip");
    assert.equal(observation.market.execution.realizedPnlSwapHive, 0.1);
    assert.equal(observation.claims.realizedPnlHbd, null);
    assert.equal(observation.claims.causalEffect, null);
});
test("mixed or incomplete market receipts refuse realized P/L", ()=>{
    const observation = buildDervishTrialObservation({
        coordinate: readDervishScheduleStep(8, roster),
        observedAt: "2026-07-20T00:01:00.000Z",
        votingReceipts: Object.freeze([]),
        curationPredictions: Object.freeze([]),
        tradingReceipts: Object.freeze([
            Object.freeze({
                lane: "trading",
                action: "trade-bundle",
                target: "complete",
                status: "broadcast",
                economicEffect: Object.freeze({
                    status: "confirmed",
                    source: "confirmation",
                    confirmedLegs: 2,
                    expectedLegs: 2,
                    realizedPnlSwapHive: 0.2
                })
            }),
            Object.freeze({
                lane: "trading",
                action: "trade",
                target: "incomplete",
                status: "broadcast",
                economicEffect: Object.freeze({
                    status: "partial",
                    source: "confirmation"
                })
            })
        ])
    });
    assert.equal(observation.market.execution.status, "confirmation-incomplete");
    assert.equal(observation.market.execution.realizedPnlSwapHive, null);
});
test("a broadcast-labelled vote without a transaction id is not called cast or pending", ()=>{
    const observation = buildDervishTrialObservation({
        coordinate: readDervishScheduleStep(9, roster),
        observedAt: "2026-07-20T00:02:00.000Z",
        votingReceipts: Object.freeze([
            Object.freeze({
                lane: "voting",
                action: "vote",
                target: "author/post",
                status: "broadcast"
            })
        ]),
        curationPredictions: Object.freeze([]),
        tradingReceipts: Object.freeze([])
    });
    assert.equal(observation.attention.votes[0]?.execution.status, "broadcast-unverified");
    assert.equal(observation.attention.votes[0]?.execution.actualVoteCast, false);
    assert.equal(observation.attention.votes[0]?.curationSettlement.status, "broadcast-without-prediction-link");
});

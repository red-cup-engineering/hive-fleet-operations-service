import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SCOREBOARD_SCHEMA, recordScoreboardTick, renderAccountReport, valuePortfolioHbd } from "../src/core/scoreboard.mjs";
const account = "profit-witness";
function state(hbd) {
    return Object.freeze({
        account,
        hive: "2.000 HIVE",
        hbd,
        currentMana: "10000",
        maxMana: "10000",
        tokens: Object.freeze({
            DUST: "3.000"
        })
    });
}
const liquidity = Object.freeze({
    kind: "aagaard.liquidity",
    venues: Object.freeze([
        Object.freeze({
            venue: "hive-internal",
            pair: "HIVE/HBD",
            midpoint: 0.5,
            bidDepth: 100,
            askDepth: 100,
            relativeSpreadBps: 20,
            imbalance: 0,
            thin: false
        })
    ]),
    pools: Object.freeze([]),
    corridors: Object.freeze([]),
    totalDepthProxy: 200,
    rigidity: Object.freeze({}),
    flow: Object.freeze([]),
    screening: Object.freeze([])
});
const plan = Object.freeze({
    account,
    hive: "2.000 HIVE",
    hbd: "1.000 HBD",
    liveEligible: true,
    liquidity,
    trades: Object.freeze([
        Object.freeze({
            pair: "SWAP.HIVE/CENT",
            side: "buy",
            amount: 5,
            edgeBps: 200,
            reason: "fixture",
            funded: true,
            quantity: "1.00000000"
        })
    ]),
    bundles: Object.freeze([]),
    lp: Object.freeze([]),
    savings: null,
    arbitrageCycles: Object.freeze([]),
    cycleCapacities: Object.freeze([]),
    allocation: Object.freeze({
        funded: Object.freeze([
            "0"
        ]),
        totalCost: 5,
        totalBenefit: 0.1,
        consideredCount: 1,
        fundedCount: 1,
        choiceBits: 0,
        exact: true
    }),
    arena: Object.freeze({})
});
const noExecution = Object.freeze({
    mode: "propose-only",
    tradesExecuted: 0,
    bundlesExecuted: 0,
    lpExecuted: 0,
    savingsExecuted: false,
    receipts: Object.freeze([])
});
test("SWAP.HIVE holdings are not silently marked at native HIVE's midpoint", ()=>{
    const marked = valuePortfolioHbd({
        hive: "2.000 HIVE",
        hbd: "1.000 HBD",
        tokens: {
            "SWAP.HIVE": "10.000"
        }
    }, liquidity);
    assert.equal(marked, 2);
});
test("an observed portfolio increase remains unreconciled rather than becoming profit", async ()=>{
    const root = mkdtempSync(path.join(tmpdir(), "aagaard-scoreboard-cashflow-"));
    try {
        await recordScoreboardTick(root, account, state("1.000 HBD"), liquidity, null, plan, noExecution, 0, "2026-07-19T00:00:00.000Z");
        const entry = await recordScoreboardTick(root, account, state("4.000 HBD"), liquidity, null, plan, noExecution, 0, "2026-07-19T00:01:00.000Z");
        assert.equal(entry.observedUnreconciledDeltaHbd, 3);
        assert.equal(entry.realizedTradePnlHbd, null);
        assert.equal(entry.cashFlowReconciliation, "missing");
        assert.equal(entry.profitClaimStatus, "unproven");
    } finally{
        rmSync(root, {
            recursive: true,
            force: true
        });
    }
});

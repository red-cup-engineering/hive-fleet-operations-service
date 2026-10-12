import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { foldMakerOrderEpisodes, guardFleetSelfCross, normalizeMakerOpenOrder, readMakerOrderEpisodes, readMakerOrderScans, recordMakerOrderScan } from "../src/core/makerOrders.mjs";
import { createHiveEngineClient } from "../src/integrations/hive-engine/hiveEngine.adapter.mjs";
import { loadAagaardConfig, planTrades } from "../src/core/core.adapter.mjs";
import { hiveWalletMoves } from "../src/agent/hive-fleet-domain.mjs";
function order(account, side, txId, price, quantity = "10.000") {
    const normalized = normalizeMakerOpenOrder({
        account,
        symbol: "DEC",
        txId,
        price,
        quantity,
        ...side === "buy" ? {
            tokensLocked: (Number(price) * Number(quantity)).toFixed(8)
        } : {},
        timestamp: 1_720_000_000,
        expiration: 1_720_003_600
    }, side);
    assert.ok(normalized);
    return normalized;
}
function scan(accounts, orders, observedAt, complete = true) {
    return Object.freeze({
        kind: "aagaard.maker-order-scan",
        observedAt,
        source: "hive-engine.market.buyBook+sellBook",
        accountsRequested: Object.freeze([
            ...accounts
        ]),
        accountsObserved: Object.freeze(complete ? [
            ...accounts
        ] : []),
        complete,
        orders: Object.freeze([
            ...orders
        ]),
        limitations: Object.freeze(complete ? [] : [
            "fixture unavailable"
        ])
    });
}
test("normalizes exact open-order units and contract epoch seconds", ()=>{
    const bid = order("Alpha", "buy", "bid-1", "0.00100000");
    const ask = order("Beta", "sell", "ask-1", "0.00120000");
    assert.equal(bid.account, "alpha");
    assert.deepEqual(bid.tokensLocked, {
        quantity: "0.01000000",
        symbol: "SWAP.HIVE"
    });
    assert.deepEqual(ask.tokensLocked, {
        quantity: "10.000",
        symbol: "DEC"
    });
    assert.equal(bid.remainingQuantityUnit, "DEC");
    assert.equal(bid.timestamp, "2024-07-03T09:46:40.000Z");
    assert.equal(bid.expiration, "2024-07-03T10:46:40.000Z");
});
test("fleet self-cross guard catches equality across accounts and fails closed without complete coverage", ()=>{
    const ask = order("beta", "sell", "ask-1", "0.00120000");
    const complete = scan([
        "alpha",
        "beta"
    ], [
        ask
    ], "2026-07-20T12:00:00.000Z");
    const crossing = guardFleetSelfCross({
        account: "alpha",
        symbol: "dec",
        side: "buy",
        priceSwapHivePerToken: "0.0012"
    }, complete);
    assert.equal(crossing.admitted, false);
    assert.equal(crossing.admitted ? null : crossing.reason, "fleet-self-cross");
    assert.equal(crossing.admitted ? 0 : crossing.conflictingOrders[0]?.account, "beta");
    assert.equal(guardFleetSelfCross({
        account: "alpha",
        symbol: "DEC",
        side: "buy",
        priceSwapHivePerToken: "0"
    }, complete).admitted, false);
    const unavailable = guardFleetSelfCross({
        account: "alpha",
        symbol: "DEC",
        side: "sell",
        priceSwapHivePerToken: "0.0013"
    }, scan([
        "alpha"
    ], [], "2026-07-20T12:01:00.000Z", false));
    assert.equal(unavailable.admitted, false);
    assert.equal(unavailable.admitted ? null : unavailable.reason, "fleet-order-reading-unavailable");
});
test("Hive-Engine adapter reads both live order tables for every fleet account", async ()=>{
    const requests = [];
    const fetchImpl = async (_input, init)=>{
        const payload = JSON.parse(String(init?.body));
        const account = payload.params.query.account ?? "";
        requests.push({
            table: payload.params.table,
            account
        });
        const result = payload.params.table === "sellBook" && account === "beta" ? [
            {
                account,
                symbol: "DEC",
                txId: "ask-1",
                price: "0.00120000",
                quantity: "10.000",
                timestamp: 1_720_000_000,
                expiration: 1_720_003_600
            }
        ] : [];
        return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result
        }), {
            status: 200,
            headers: {
                "content-type": "application/json"
            }
        });
    };
    const client = createHiveEngineClient({
        nodes: [
            "https://example.invalid/contracts"
        ],
        timeoutMs: 1000,
        balanceLimit: 10,
        marketLimit: 10,
        poolLimit: 10,
        symbols: [
            "DEC"
        ],
        fetch: fetchImpl
    });
    const reading = await client.readFleetOpenOrders([
        "alpha",
        "beta"
    ], "2026-07-20T12:00:00.000Z");
    assert.equal(reading.complete, true);
    assert.deepEqual(reading.accountsObserved, [
        "alpha",
        "beta"
    ]);
    assert.equal(reading.orders.length, 1);
    assert.deepEqual(requests.sort((left, right)=>`${left.account}:${left.table}`.localeCompare(`${right.account}:${right.table}`)), [
        {
            table: "buyBook",
            account: "alpha"
        },
        {
            table: "sellBook",
            account: "alpha"
        },
        {
            table: "buyBook",
            account: "beta"
        },
        {
            table: "sellBook",
            account: "beta"
        }
    ]);
});
test("round-trip allocation excludes self-crossing legs and live execution refuses an unguarded plan", async ()=>{
    const wallet = loadAagaardConfig().wallets.find((entry)=>entry.account === "sigmund-vexler");
    assert.ok(wallet);
    const state = Object.freeze({
        account: wallet.account,
        hive: "1.000 HIVE",
        hbd: "1.000 HBD",
        currentMana: "9000",
        maxMana: "10000",
        tokens: Object.freeze({
            "SWAP.HIVE": "1.00000000"
        })
    });
    const market = Object.freeze({
        observedAt: new Date().toISOString(),
        tokens: state.tokens,
        venues: Object.freeze([
            Object.freeze({
                venue: "hive-engine",
                pair: "DEC/SWAP.HIVE",
                midpoint: 0.00115,
                bestBid: 0.0012,
                bestAsk: 0.0013,
                bestBidQuantity: 10_000,
                bestAskQuantity: 10_000,
                bidDepth: 10_000,
                askDepth: 10_000,
                relativeSpreadBps: 800,
                imbalance: 0,
                thin: false,
                exactBook: Object.freeze({
                    observedAt: new Date().toISOString(),
                    bids: Object.freeze([
                        {
                            priceSwapHivePerToken: "0.00120000",
                            quantity: "10000.000"
                        }
                    ]),
                    asks: Object.freeze([
                        {
                            priceSwapHivePerToken: "0.00130000",
                            quantity: "10000.000"
                        }
                    ]),
                    bidComplete: true,
                    askComplete: true,
                    bidOrdered: true,
                    askOrdered: true
                })
            })
        ]),
        pools: Object.freeze([
            Object.freeze({
                pair: "DEC:SWAP.HIVE",
                impliedPrice: 0.0009,
                baseQuantity: 1_000_000,
                quoteQuantity: 900,
                baseQuantityExact: "1000000.000",
                quoteQuantityExact: "900.00000000",
                tvlQuote: 1_800,
                feeBps: 0
            })
        ]),
        precision: Object.freeze({
            DEC: 3,
            "SWAP.HIVE": 8
        })
    });
    const crossingBid = order("michael561", "buy", "fleet-bid", "0.00120000");
    const refused = planTrades(wallet, "2026-07-20T12:00:00.000Z", state, market, null, {}, scan([
        "michael561",
        wallet.account
    ], [
        crossingBid
    ], "2026-07-20T12:00:00.000Z"));
    assert.ok(refused.bundles.some((bundle)=>bundle.refusalReason?.includes("fleet-owned buy order")));
    assert.equal(refused.bundles.some((bundle)=>bundle.funded), false);
    const unguarded = planTrades(wallet, "2026-07-20T12:00:00.000Z", state, market);
    assert.ok(unguarded.bundles.some((bundle)=>bundle.funded));
    const moves = hiveWalletMoves({ wallet, plans: { trading: unguarded }, armed: { voting: false, trading: true, incentive: false } });
    assert.equal(moves.some((candidate)=>candidate.action === "trade-bundle" && candidate.state === "ready"), false);
});

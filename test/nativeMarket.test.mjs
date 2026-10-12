import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createHiveClient } from "../src/integrations/hive/hive.adapter.mjs";
import { nativeCancelOrderOperation, nativeLimitOrderOperation, nativeMarketVwap, planNativeMarketCycle } from "../src/core/nativeMarket.mjs";
import { serializeOperation } from "@red-cup-engineering/hive-blockchain-client-service/serialize.mjs";
import { cycle, parseOptions } from "../scripts/native-market-cycle.mjs";
// The signer must never find a real key under test.
process.env.HIVE_KEY_ROOT = "/nonexistent-hive-key-root";
function observation(overrides = {}) {
    const history = Object.freeze([
        {
            openedAt: "2026-08-20T12:00:00Z",
            seconds: 60,
            closeHbd: 310,
            closeHive: 1000,
            volumeHive: 10,
            volumeHbd: 3.1
        }
    ]);
    return Object.freeze({
        kind: "aagaard.native-market-observation",
        account: "sigmund-vexler",
        observedAt: "2026-08-20T12:05:00.000Z",
        windowMinutes: 5,
        bestBid: 0.307,
        bestAsk: 0.309,
        spread: 0.002,
        spreadBps: 65,
        bids: Object.freeze([
            {
                priceHbdPerHive: 0.307,
                hiveQuantity: 10,
                hbdQuantity: 3.07
            }
        ]),
        asks: Object.freeze([
            {
                priceHbdPerHive: 0.309,
                hiveQuantity: 10,
                hbdQuantity: 3.09
            }
        ]),
        history,
        vwapHbdPerHive: nativeMarketVwap(history),
        hiveBalance: "2.000 HIVE",
        hbdBalance: "2.000 HBD",
        openOrders: Object.freeze([]),
        orderEvents: Object.freeze([]),
        complete: true,
        limitations: Object.freeze([]),
        ...overrides
    });
}
test("plans a bounded fill-or-kill acquisition and chain-contingent maker exit", ()=>{
    const plan = planNativeMarketCycle(observation());
    assert.equal(plan.admitted, true);
    assert.equal(plan.buy?.side, "buy-hive");
    assert.equal(plan.buy?.fillOrKill, true);
    assert.equal(plan.contingentSell?.side, "sell-hive");
    assert.equal(plan.contingentSell?.fillOrKill, false);
    assert.equal(plan.buy?.quantityHive, "1.000");
    assert.equal(plan.contingentSell?.priceHbdPerHive, "0.310");
    assert.equal(plan.expectedGrossProceedsHbd, "0.001");
});
test("fails closed on incomplete reads, stale economics, depth, balances, and open-order cap", ()=>{
    assert.equal(planNativeMarketCycle(observation({
        complete: false,
        limitations: [
            "history-unavailable"
        ]
    })).admitted, false);
    assert.equal(planNativeMarketCycle(observation({
        bestAsk: 0.311
    })).admitted, false);
    assert.equal(planNativeMarketCycle(observation({
        asks: []
    })).admitted, false);
    assert.equal(planNativeMarketCycle(observation({
        hbdBalance: "0.000 HBD"
    })).admitted, false);
    assert.equal(planNativeMarketCycle(observation({
        openOrders: Array.from({
            length: 10
        }, (_, orderId)=>({
                orderId,
                createdAt: "2026-08-20T12:00:00Z",
                expiresAt: "2026-08-20T13:00:00Z",
                amountToSell: "1.000 HBD",
                minToReceive: "1.000 HIVE",
                side: "buy-hive"
            }))
    })).admitted, false);
});
test("builds and serializes exact native Hive operations", ()=>{
    const plan = planNativeMarketCycle(observation());
    assert.ok(plan.buy);
    const buy = nativeLimitOrderOperation(plan.buy);
    assert.deepEqual(buy[1], {
        owner: "sigmund-vexler",
        orderid: plan.buy.orderId,
        amount_to_sell: "0.309 HBD",
        min_to_receive: "1.000 HIVE",
        fill_or_kill: true,
        expiration: "2026-08-20T12:10:00Z"
    });
    assert.ok(serializeOperation(buy).length > 0);
    assert.ok(serializeOperation(nativeCancelOrderOperation("sigmund-vexler", plan.buy.orderId)).length > 0);
});
test("reads native book, five-minute history, balances, and open orders as one observation", async ()=>{
    const methods = [];
    const fetchImpl = async (_input, init)=>{
        const request = JSON.parse(String(init?.body));
        methods.push(request.method);
        const result = request.method.endsWith("get_order_book") ? {
            bids: [
                {
                    real_price: "0.307",
                    hive: 10000,
                    hbd: 3070
                }
            ],
            asks: [
                {
                    real_price: "0.309",
                    hive: 10000,
                    hbd: 3090
                }
            ]
        } : request.method.endsWith("get_market_history") ? [
            {
                open: "2026-08-20T12:00:00",
                seconds: 60,
                hive: {
                    close: 1000,
                    volume: 10
                },
                non_hive: {
                    close: 310,
                    volume: 3.1
                }
            }
        ] : request.method.endsWith("get_accounts") ? [
            {
                balance: "2.000 HIVE",
                hbd_balance: "2.000 HBD"
            }
        ] : request.method.endsWith("get_account_history") ? [
            [
                9,
                {
                    trx_id: "abc",
                    timestamp: "2026-08-20T11:59:00",
                    op: [
                        "limit_order_cancel",
                        {
                            owner: "sigmund-vexler",
                            orderid: 6
                        }
                    ]
                }
            ]
        ] : [
            {
                orderid: 7,
                created: "2026-08-20T12:00:00",
                expiration: "2026-08-20T12:10:00",
                sell_price: {
                    base: "1.000 HBD",
                    quote: "3.000 HIVE"
                }
            }
        ];
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
    const client = createHiveClient({
        nodes: [
            "https://example.invalid"
        ],
        timeoutMs: 1000,
        perSourceLimit: 20,
        fetch: fetchImpl
    });
    const read = await client.readNativeMarket("sigmund-vexler", 5);
    assert.equal(read.complete, true);
    assert.equal(read.vwapHbdPerHive, 0.31);
    assert.equal(read.openOrders[0]?.side, "buy-hive");
    assert.equal(read.orderEvents[0]?.operation, "limit_order_cancel");
    assert.deepEqual(methods.sort(), [
        "condenser_api.get_account_history",
        "condenser_api.get_accounts",
        "condenser_api.get_market_history",
        "condenser_api.get_open_orders",
        "condenser_api.get_order_book"
    ]);
});
test("signer membrane admits only bounded native-market order and cancellation envelopes", ()=>{
    const script = fileURLToPath(new URL("../scripts/hive-broadcast.mjs", import.meta.url));
    const base = {
        kind: "aagaard.hive-write",
        account: "sigmund-vexler",
        role: "active",
        lane: "native-market",
        target: "order:42"
    };
    const validFields = {
        owner: "sigmund-vexler",
        orderid: 42,
        amount_to_sell: "0.309 HBD",
        min_to_receive: "1.000 HIVE",
        fill_or_kill: true,
        expiration: new Date(Date.now() + 240_000).toISOString()
    };
    const validOrder = [
        "limit_order_create",
        validFields
    ];
    const admitted = spawnSync(process.execPath, [
        script
    ], {
        input: JSON.stringify({
            ...base,
            operation: validOrder
        }),
        encoding: "utf8"
    });
    assert.match(admitted.stdout, /key-unavailable/);
    assert.doesNotMatch(admitted.stdout, /refusing operation|native market order/);
    const excessive = [
        "limit_order_create",
        {
            owner: "sigmund-vexler",
            orderid: 42,
            amount_to_sell: "0.309 HBD",
            min_to_receive: "5.001 HIVE",
            fill_or_kill: true,
            expiration: validFields.expiration
        }
    ];
    const refused = spawnSync(process.execPath, [
        script
    ], {
        input: JSON.stringify({
            ...base,
            operation: excessive
        }),
        encoding: "utf8"
    });
    assert.match(refused.stdout, /moves more HIVE than @sigmund-vexler.s cap/);
    const cancellation = [
        "limit_order_cancel",
        {
            owner: "sigmund-vexler",
            orderid: 42
        }
    ];
    const cancelAdmitted = spawnSync(process.execPath, [
        script
    ], {
        input: JSON.stringify({
            ...base,
            operation: cancellation
        }),
        encoding: "utf8"
    });
    assert.match(cancelAdmitted.stdout, /key-unavailable/);
});
test("independent Hive providers must agree before native trading is admitted", async ()=>{
    const fetchImpl = async (input, init)=>{
        const request = JSON.parse(String(init?.body));
        const node = String(input);
        const result = request.method.endsWith("get_order_book") ? {
            bids: [
                {
                    real_price: "0.307",
                    hive: 10000,
                    hbd: 3070
                }
            ],
            asks: [
                {
                    real_price: node.includes("one") ? "0.309" : "0.310",
                    hive: 10000,
                    hbd: 3090
                }
            ]
        } : request.method.endsWith("get_market_history") ? [
            {
                open: "2026-08-20T12:00:00",
                seconds: 60,
                hive: {
                    close: 1000,
                    volume: 10
                },
                non_hive: {
                    close: 310,
                    volume: 3.1
                }
            }
        ] : request.method.endsWith("get_accounts") ? [
            {
                balance: "2.000 HIVE",
                hbd_balance: "2.000 HBD"
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
    const client = createHiveClient({
        nodes: [
            "https://one.invalid",
            "https://two.invalid"
        ],
        timeoutMs: 1000,
        perSourceLimit: 20,
        fetch: fetchImpl
    });
    const read = await client.readNativeMarket("sigmund-vexler", 5);
    assert.equal(read.complete, false);
    assert.ok(read.limitations.includes("order-book-unavailable"));
    assert.equal(planNativeMarketCycle(read).admitted, false);
});
test("cycle CLI is dry-run by default and cancellation requires explicit live authority", async ()=>{
    const options = parseOptions([
        "--account",
        "sigmund-vexler"
    ]);
    assert.equal(options.live, false);
    assert.throws(()=>parseOptions([
            "--account",
            "sigmund-vexler",
            "--cancel-all"
        ]), /requires --live/);
    const result = await cycle(options, {
        config: {
            hive: {},
            accounts: [
                {
                    account: "sigmund-vexler"
                }
            ]
        },
        client: {
            async readNativeMarket () {
                return observation();
            }
        }
    });
    assert.equal(result.mode, "dry-run");
    assert.equal(result.chainMutation, false);
    assert.equal(result.plan.admitted, true);
});

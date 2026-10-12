import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseOptions, planLiquidation, statesAgree } from "../scripts/liquidate-token.mjs";
// The signer must never find a real key under test.
process.env.HIVE_KEY_ROOT = "/nonexistent-hive-key-root";
const STATE = Object.freeze({
    account: "michael561",
    symbol: "ARCHMAGE",
    precision: 0,
    balance: "1",
    swapHiveBalance: "14.70303390",
    observedAt: "2026-07-22T03:55:00.000Z",
    bids: Object.freeze([
        Object.freeze({
            account: "buyer",
            price: "40.00000000",
            quantity: "1",
            txId: "a".repeat(40),
            expiration: 1787220909
        }),
        Object.freeze({
            account: "buyer2",
            price: "35.00000000",
            quantity: "1",
            txId: "b".repeat(40),
            expiration: 1787215929
        })
    ])
});
test("full-balance liquidation uses displayed depth and an exact hard floor", ()=>{
    const plan = planLiquidation(STATE);
    assert.equal(plan.kind, "sell");
    if (plan.kind !== "sell") return;
    assert.equal(plan.quantity, "1");
    assert.equal(plan.floorPrice, "40.00000000");
    assert.equal(plan.minimumSwapHive, "40.00000000");
    assert.equal(plan.displayedGrossSwapHive, "40.00000000");
    assert.deepEqual(plan.operation, [
        "custom_json",
        {
            id: "ssc-mainnet-hive",
            required_auths: [
                "michael561"
            ],
            required_posting_auths: [],
            json: '{"contractName":"market","contractAction":"sell","contractPayload":{"symbol":"ARCHMAGE","quantity":"1","price":"40.00000000","expiration":300}}'
        }
    ]);
});
test("liquidation refuses partial depth, excessive floor slippage, dust, and fleet bids", ()=>{
    assert.match(planLiquidation({
        ...STATE,
        balance: "3"
    }).reason, /cannot fill/);
    assert.match(planLiquidation({
        ...STATE,
        balance: "2"
    }, 500).reason, /bps below/);
    assert.match(planLiquidation({
        ...STATE,
        symbol: "DUST",
        precision: 3,
        balance: "1.000",
        bids: [
            {
                ...STATE.bids[0],
                price: "0.00000001",
                quantity: "1.000"
            }
        ]
    }).reason, /less than 0.001/);
    assert.match(planLiquidation({
        ...STATE,
        bids: []
    }).reason, /no non-fleet live bid/);
});
test("liquidation options and independent evidence are exact", ()=>{
    assert.deepEqual(parseOptions([
        "--account",
        "michael561",
        "--symbol",
        "archmage"
    ]), {
        account: "michael561",
        symbol: "ARCHMAGE",
        executeOne: false,
        maxSlippageBps: 500
    });
    assert.equal(statesAgree(STATE, {
        ...STATE,
        observedAt: "later"
    }), true);
    assert.equal(statesAgree(STATE, {
        ...STATE,
        balance: "2"
    }), false);
});
test("Hive broadcaster admits only the exact price-floored liquidation envelope", async ()=>{
    const script = fileURLToPath(new URL("../scripts/hive-broadcast.mjs", import.meta.url));
    const run = (overrides = {})=>new Promise((resolve)=>{
            const child = spawn(process.execPath, [
                script
            ], {
                stdio: [
                    "pipe",
                    "pipe",
                    "ignore"
                ]
            });
            let stdout = "";
            child.stdout.on("data", (chunk)=>{
                stdout += String(chunk);
            });
            child.on("close", (code)=>resolve({
                    code,
                    stdout
                }));
            const payload = {
                symbol: "ARCHMAGE",
                quantity: "1",
                price: "40.00000000",
                expiration: 300
            };
            child.stdin.end(JSON.stringify({
                account: "michael561",
                role: "active",
                lane: "liquidity-exit",
                target: "liquidate:ARCHMAGE:1:40.00000000",
                operation: [
                    "custom_json",
                    {
                        id: "ssc-mainnet-hive",
                        required_auths: [
                            "michael561"
                        ],
                        required_posting_auths: [],
                        json: JSON.stringify({
                            contractName: "market",
                            contractAction: "sell",
                            contractPayload: payload
                        })
                    }
                ],
                ...overrides
            }));
        });
    assert.match((await run()).stdout, /key-unavailable/);
    assert.match((await run({
        target: "liquidate:ARCHMAGE:1:0.00000001"
    })).stdout, /price-floored/);
    assert.match((await run({
        lane: "trading"
    })).stdout, /key-unavailable/);
});

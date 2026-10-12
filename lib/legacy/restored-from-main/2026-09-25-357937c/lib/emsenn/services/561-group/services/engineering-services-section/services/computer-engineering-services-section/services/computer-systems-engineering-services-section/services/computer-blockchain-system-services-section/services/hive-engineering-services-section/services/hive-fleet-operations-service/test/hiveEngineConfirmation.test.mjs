import assert from "node:assert/strict";
import test from "node:test";
import { assessRoundTripEconomicEffect } from "../src/integrations/hive-engine/hiveEngineConfirmation.mjs";
const account = "profit-witness";
function row(transactionId, contract, action, events, errors = []) {
    return {
        transactionId,
        contract,
        action,
        logs: JSON.stringify({
            events,
            errors
        })
    };
}
function transfer(event, data) {
    return {
        contract: "tokens",
        event,
        data
    };
}
function orderClosed(type, txId) {
    return {
        contract: "market",
        event: "orderClosed",
        data: {
            account,
            type,
            txId
        }
    };
}
test("confirms pool-to-book only from the exact round trip and bounded net proceeds", ()=>{
    const calls = [
        {
            contractName: "marketpools",
            contractAction: "swapTokens",
            contractPayload: {
                tokenPair: "SWAP.HIVE:LEN",
                tokenSymbol: "LEN",
                tokenAmount: "10.000",
                tradeType: "exactOutput",
                maxAmountIn: "0.01100000"
            }
        },
        {
            contractName: "market",
            contractAction: "sell",
            contractPayload: {
                symbol: "LEN",
                quantity: "10.000",
                price: "0.00120000",
                expiration: 300
            }
        }
    ];
    const rows = [
        row("outer-0", "marketpools", "swapTokens", [
            transfer("transferToContract", {
                from: account,
                to: "marketpools",
                symbol: "SWAP.HIVE",
                quantity: "0.01050000"
            }),
            transfer("transferFromContract", {
                from: "marketpools",
                to: account,
                symbol: "LEN",
                quantity: "10.000"
            })
        ]),
        row("outer-1", "market", "sell", [
            transfer("transferToContract", {
                from: account,
                to: "null",
                symbol: "BEED",
                quantity: "0.0010"
            }),
            transfer("transferToContract", {
                from: account,
                to: "market",
                symbol: "LEN",
                quantity: "10.000"
            }),
            transfer("transferFromContract", {
                from: "market",
                to: account,
                symbol: "SWAP.HIVE",
                quantity: "0.01200000"
            }),
            orderClosed("sell", "outer-1")
        ])
    ];
    const effect = assessRoundTripEconomicEffect(account, calls, rows);
    assert.equal(effect.status, "confirmed");
    assert.equal(effect.confirmedLegs, 2);
    assert.equal(effect.realizedInputSwapHive, "0.01050000");
    assert.equal(effect.realizedProceedsSwapHive, "0.01200000");
    assert.equal(effect.realizedGrossDeltaSwapHive, "0.00150000");
    assert.equal(effect.realizedFeeBeed, "0.0010");
});
test("confirms book-to-pool using the market cost and exact-input pool exit", ()=>{
    const calls = [
        {
            contractName: "market",
            contractAction: "buy",
            contractPayload: {
                symbol: "LEN",
                quantity: "10.000",
                price: "0.00100000",
                expiration: 300
            }
        },
        {
            contractName: "marketpools",
            contractAction: "swapTokens",
            contractPayload: {
                tokenPair: "SWAP.HIVE:LEN",
                tokenSymbol: "LEN",
                tokenAmount: "10.000",
                tradeType: "exactInput",
                minAmountOut: "0.01050000"
            }
        }
    ];
    const rows = [
        row("outer-0", "market", "buy", [
            transfer("transferToContract", {
                from: account,
                to: "market",
                symbol: "SWAP.HIVE",
                quantity: "0.01000000"
            }),
            transfer("transferFromContract", {
                from: "market",
                to: account,
                symbol: "LEN",
                quantity: "10.000"
            }),
            orderClosed("buy", "outer-0")
        ]),
        row("outer-1", "marketpools", "swapTokens", [
            transfer("transferToContract", {
                from: account,
                to: "marketpools",
                symbol: "LEN",
                quantity: "10.000"
            }),
            transfer("transferFromContract", {
                from: "marketpools",
                to: account,
                symbol: "SWAP.HIVE",
                quantity: "0.01100000"
            })
        ])
    ];
    const effect = assessRoundTripEconomicEffect(account, calls, rows);
    assert.equal(effect.status, "confirmed");
    assert.equal(effect.confirmedLegs, 2);
    assert.equal(effect.realizedGrossDeltaSwapHive, "0.00100000");
});
test("reports partial when full escrow and enough proceeds do not prove the order closed", ()=>{
    const calls = [
        {
            contractName: "marketpools",
            contractAction: "swapTokens",
            contractPayload: {
                tokenPair: "SWAP.HIVE:LEN",
                tokenSymbol: "LEN",
                tokenAmount: "10.000",
                tradeType: "exactOutput",
                maxAmountIn: "0.01100000"
            }
        },
        {
            contractName: "market",
            contractAction: "sell",
            contractPayload: {
                symbol: "LEN",
                quantity: "10.000",
                price: "0.00120000",
                expiration: 300
            }
        }
    ];
    const rows = [
        row("outer-0", "marketpools", "swapTokens", [
            transfer("transferToContract", {
                from: account,
                to: "marketpools",
                symbol: "SWAP.HIVE",
                quantity: "0.01050000"
            }),
            transfer("transferFromContract", {
                from: "marketpools",
                to: account,
                symbol: "LEN",
                quantity: "10.000"
            })
        ]),
        row("outer-1", "market", "sell", [
            transfer("transferToContract", {
                from: account,
                to: "market",
                symbol: "LEN",
                quantity: "10.000"
            }),
            transfer("transferFromContract", {
                from: "market",
                to: account,
                symbol: "SWAP.HIVE",
                quantity: "0.01200000"
            })
        ])
    ];
    const effect = assessRoundTripEconomicEffect(account, calls, rows);
    assert.equal(effect.status, "partial");
    assert.equal(effect.confirmedLegs, 1);
});
test("does not round a transfer beyond JavaScript's safe integer range into profit", ()=>{
    const quantity = "9007199254740993.000";
    const calls = [
        {
            contractName: "marketpools",
            contractAction: "swapTokens",
            contractPayload: {
                tokenPair: "SWAP.HIVE:LEN",
                tokenSymbol: "LEN",
                tokenAmount: quantity,
                tradeType: "exactOutput",
                maxAmountIn: "9007199254740.99300000"
            }
        },
        {
            contractName: "market",
            contractAction: "sell",
            contractPayload: {
                symbol: "LEN",
                quantity,
                price: "0.00100000",
                expiration: 300
            }
        }
    ];
    const rows = [
        row("outer-0", "marketpools", "swapTokens", [
            transfer("transferToContract", {
                from: account,
                to: "marketpools",
                symbol: "SWAP.HIVE",
                quantity: "9007199254740.99300000"
            }),
            transfer("transferFromContract", {
                from: "marketpools",
                to: account,
                symbol: "LEN",
                quantity
            })
        ]),
        row("outer-1", "market", "sell", [
            transfer("transferToContract", {
                from: account,
                to: "market",
                symbol: "LEN",
                quantity
            }),
            transfer("transferFromContract", {
                from: "market",
                to: account,
                symbol: "SWAP.HIVE",
                quantity: "9007199254740.99300000"
            }),
            orderClosed("sell", "outer-1")
        ])
    ];
    const effect = assessRoundTripEconomicEffect(account, calls, rows);
    assert.equal(effect.status, "confirmed");
    assert.equal(effect.realizedGrossDeltaSwapHive, "0.00000000");
});

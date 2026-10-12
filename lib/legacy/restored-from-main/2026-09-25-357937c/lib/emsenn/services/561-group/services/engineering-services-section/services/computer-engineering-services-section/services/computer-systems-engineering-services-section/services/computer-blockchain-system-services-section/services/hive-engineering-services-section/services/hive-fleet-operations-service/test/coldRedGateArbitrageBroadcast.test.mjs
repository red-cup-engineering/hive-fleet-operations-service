import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_KEY_ROOT, validateBundledRoundTripRequest, validateSellLegRequest, validateSwapLegRequest } from "../scripts/cold-red-gate-arbitrage-broadcast.mjs";
test("DEFAULT_KEY_ROOT names the shared key directory, not one account's file -- AAGAARD_COLD_RED_GATE_KEY_ROOT overrides it per host", ()=>{
    assert.ok(DEFAULT_KEY_ROOT.endsWith("/blockchain/hive"));
    assert.ok(!DEFAULT_KEY_ROOT.includes("active.wif"), "the root is a directory prefix, not a per-account file path");
});
function swapLeg() {
    const calls = [
        {
            contractName: "marketpools",
            contractAction: "swapTokens",
            contractPayload: {
                tokenPair: "SWAP.HIVE:LEN",
                tokenSymbol: "LEN",
                tokenAmount: "100.000",
                tradeType: "exactOutput",
                maxAmountIn: "0.10000000"
            }
        }
    ];
    return {
        kind: "aagaard.hive-write",
        account: "sigmund-vexler",
        role: "active",
        lane: "trading",
        target: "LEN:pool-to-book-round-trip",
        keyFile: "cold-red-gate:sigmund-vexler/active",
        leg: "swap",
        pricedOverheadSwapHive: "0.00020000",
        pairedSellPriceSwapHive: "0.00102000",
        operation: [
            "custom_json",
            {
                id: "ssc-mainnet-hive",
                required_auths: [
                    "sigmund-vexler"
                ],
                required_posting_auths: [],
                json: JSON.stringify(calls)
            }
        ]
    };
}
function sellLegRoundTrip() {
    const calls = [
        {
            contractName: "market",
            contractAction: "sell",
            contractPayload: {
                symbol: "LEN",
                quantity: "100.000",
                price: "0.00102000",
                expiration: 300
            }
        }
    ];
    return {
        kind: "aagaard.hive-write",
        account: "sigmund-vexler",
        role: "active",
        lane: "trading",
        target: "LEN:pool-to-book-round-trip",
        keyFile: "cold-red-gate:sigmund-vexler/active",
        leg: "sell",
        pricedOverheadSwapHive: "0.00020000",
        pairedSwapMaxAmountInSwapHive: "0.10000000",
        operation: [
            "custom_json",
            {
                id: "ssc-mainnet-hive",
                required_auths: [
                    "sigmund-vexler"
                ],
                required_posting_auths: [],
                json: JSON.stringify(calls)
            }
        ]
    };
}
function sellLegReconciliation() {
    const calls = [
        {
            contractName: "market",
            contractAction: "sell",
            contractPayload: {
                symbol: "GLD",
                quantity: "4.1917",
                price: "0.24374988",
                expiration: 300
            }
        }
    ];
    return {
        kind: "aagaard.hive-write",
        account: "michael561",
        role: "active",
        lane: "trading",
        target: "GLD:reconciliation-sell",
        keyFile: "cold-red-gate:michael561/active",
        leg: "sell",
        operation: [
            "custom_json",
            {
                id: "ssc-mainnet-hive",
                required_auths: [
                    "michael561"
                ],
                required_posting_auths: [],
                json: JSON.stringify(calls)
            }
        ]
    };
}
function bundle() {
    const calls = [
        {
            contractName: "marketpools",
            contractAction: "swapTokens",
            contractPayload: {
                tokenPair: "SWAP.HIVE:LEN",
                tokenSymbol: "LEN",
                tokenAmount: "100.000",
                tradeType: "exactOutput",
                maxAmountIn: "0.10000000"
            }
        },
        {
            contractName: "market",
            contractAction: "sell",
            contractPayload: {
                symbol: "LEN",
                quantity: "100.000",
                price: "0.00102000",
                expiration: 300
            }
        }
    ];
    return {
        kind: "aagaard.hive-write",
        account: "sigmund-vexler",
        role: "active",
        lane: "trading",
        target: "LEN:pool-to-book-round-trip",
        keyFile: "cold-red-gate:sigmund-vexler/active",
        pricedOverheadSwapHive: "0.00020000",
        operation: [
            "custom_json",
            {
                id: "ssc-mainnet-hive",
                required_auths: [
                    "sigmund-vexler"
                ],
                required_posting_auths: [],
                json: JSON.stringify(calls)
            }
        ]
    };
}
test("the swap leg admits only a profitable, capped, single-action envelope -- never bundled with its paired sell", ()=>{
    assert.equal(validateSwapLegRequest(swapLeg()), true);
    const changed = swapLeg();
    const calls = JSON.parse(changed.operation[1].json);
    calls[0].contractPayload.maxAmountIn = "1.00000001";
    changed.operation[1].json = JSON.stringify(calls);
    assert.throws(()=>validateSwapLegRequest(changed), /refused/u);
});
test("the swap leg is account-scoped for Michael's separate float", ()=>{
    const michael = swapLeg();
    michael.account = "michael561";
    michael.keyFile = "cold-red-gate:michael561/active";
    michael.operation[1].required_auths = [
        "michael561"
    ];
    assert.equal(validateSwapLegRequest(michael), true);
    michael.operation[1].required_auths = [
        "sigmund-vexler"
    ];
    assert.throws(()=>validateSwapLegRequest(michael), /refused/u);
});
test("the swap leg refuses a two-action bundle -- it validates exactly one call", ()=>{
    const bundled = swapLeg();
    const swapCall = JSON.parse(bundled.operation[1].json)[0];
    const sellCall = {
        contractName: "market",
        contractAction: "sell",
        contractPayload: {
            symbol: "LEN",
            quantity: "100.000",
            price: "0.00102000",
            expiration: 300
        }
    };
    bundled.operation[1].json = JSON.stringify([
        swapCall,
        sellCall
    ]);
    assert.throws(()=>validateSwapLegRequest(bundled), /refused/u);
});
test("the swap leg requires the priced overhead and paired sell price as exact fields, gated against the round trip's own worst-case profit", ()=>{
    const missingOverhead = swapLeg();
    delete missingOverhead.pricedOverheadSwapHive;
    assert.throws(()=>validateSwapLegRequest(missingOverhead), /refused/u);
    const missingPaired = swapLeg();
    delete missingPaired.pairedSellPriceSwapHive;
    assert.throws(()=>validateSwapLegRequest(missingPaired), /refused/u);
    const expensive = swapLeg();
    expensive.pricedOverheadSwapHive = "0.00190000";
    assert.throws(()=>validateSwapLegRequest(expensive), /refused/u);
});
test("the sell leg (round trip) admits only a profitable envelope re-gated against leg one's committed cost", ()=>{
    assert.equal(validateSellLegRequest(sellLegRoundTrip()), true);
    const expensive = sellLegRoundTrip();
    expensive.pricedOverheadSwapHive = "0.00190000";
    assert.throws(()=>validateSellLegRequest(expensive), /refused/u);
});
test("the sell leg (round trip) refuses a target/field mismatch -- pairing fields absent while the target still claims round-trip", ()=>{
    const mismatched = sellLegRoundTrip();
    delete mismatched.pricedOverheadSwapHive;
    delete mismatched.pairedSwapMaxAmountInSwapHive;
    assert.throws(()=>validateSellLegRequest(mismatched), /refused/u);
});
test("a standalone reconciliation sell admits on price/quantity alone -- no round-trip pairing required", ()=>{
    assert.equal(validateSellLegRequest(sellLegReconciliation()), true);
});
test("a reconciliation sell refuses a request that smuggles round-trip pairing fields under the reconciliation target", ()=>{
    const smuggled = sellLegReconciliation();
    smuggled.pricedOverheadSwapHive = "0.00020000";
    smuggled.pairedSwapMaxAmountInSwapHive = "0.10000000";
    assert.throws(()=>validateSellLegRequest(smuggled), /refused/u);
});
test("the legacy bundle path still admits only a profitable, capped two-action envelope (defensive, never called by this package's own automation)", ()=>{
    assert.equal(validateBundledRoundTripRequest(bundle()), true);
    const changed = bundle();
    const calls = JSON.parse(changed.operation[1].json);
    calls[0].contractPayload.maxAmountIn = "1.00000001";
    changed.operation[1].json = JSON.stringify(calls);
    assert.throws(()=>validateBundledRoundTripRequest(changed), /refused/u);
});

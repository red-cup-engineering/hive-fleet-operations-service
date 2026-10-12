import assert from "node:assert/strict";
import test from "node:test";
import { decimalUnits, formatUnits } from "@red-cup-engineering/exact-number-data-service/decimal-string";
import { sizeExactPoolToBook } from "../src/analysis/exactArbitrage.mjs";
const base = Object.freeze({
    tokenPrecision: 3,
    swapHivePrecision: 8,
    reserveInSwapHive: "1000.00000000",
    reserveOutToken: "1000000.000",
    balanceSwapHive: "1.00000000",
    capSwapHiveMilli: 1000,
    poolFeeBps: 25,
    slippageBps: 50,
    bids: Object.freeze([
        {
            priceSwapHivePerToken: "0.00120000",
            quantity: "0.185"
        },
        {
            priceSwapHivePerToken: "0.00119000",
            quantity: "1000.000"
        }
    ]),
    bidBookComplete: true,
    bidBookOrdered: true
});
test("exact decimal units reject precision loss and round-trip fixed strings", ()=>{
    assert.equal(decimalUnits("1.230", 3), 1230n);
    assert.equal(formatUnits(1230n, 3), "1.230");
    assert.throws(()=>decimalUnits("1.2301", 3), /canonical 3-place decimal/);
    assert.throws(()=>decimalUnits("1e-3", 8), /canonical 8-place decimal/);
});
test("depth-aware sizing can use cumulative bids while preserving a hard limit", ()=>{
    const result = sizeExactPoolToBook(base);
    assert.equal(result.admitted, true);
    if (!result.admitted) return;
    assert.equal(result.quote.limitSellPriceSwapHive, "0.00119000");
    assert.ok(decimalUnits(result.quote.quantity, 3) > 185n);
    assert.ok(decimalUnits(result.quote.maxInputSwapHive, 8) <= 100_000_000n);
    assert.ok(decimalUnits(result.quote.minimumProceedsSwapHive, 8) > decimalUnits(result.quote.maxInputSwapHive, 8));
});
test("pool reserves retain swap-generated precision beyond the token precision", ()=>{
    const result = sizeExactPoolToBook({
        ...base,
        reserveOutToken: "1000000.00012345"
    });
    assert.equal(result.admitted, true);
    if (result.admitted) assert.ok(decimalUnits(result.quote.maxInputSwapHive, 8) <= 100_000_000n);
});
test("truncated, unordered, and malformed depth evidence fail closed", ()=>{
    assert.deepEqual(sizeExactPoolToBook({
        ...base,
        bidBookComplete: false
    }), {
        admitted: false,
        reason: "bid book evidence is row-limit truncated"
    });
    assert.deepEqual(sizeExactPoolToBook({
        ...base,
        bidBookOrdered: false
    }), {
        admitted: false,
        reason: "bid book evidence is not price-descending"
    });
    const malformed = sizeExactPoolToBook({
        ...base,
        bids: [
            {
                priceSwapHivePerToken: "0.00120000",
                quantity: "1.0001"
            }
        ]
    });
    assert.equal(malformed.admitted, false);
    if (!malformed.admitted) assert.match(malformed.reason, /invalid exact market evidence/);
});
test("DEC depth is segmented where the 25 bps pool fee and 50 bps buffer stop paying", ()=>{
    const input = {
        ...base,
        reserveInSwapHive: "269951.22318660",
        reserveOutToken: "53827860.422",
        bids: [
            {
                priceSwapHivePerToken: "0.00506000",
                quantity: "0.185"
            },
            {
                priceSwapHivePerToken: "0.00503848",
                quantity: "504.000"
            },
            {
                priceSwapHivePerToken: "0.00503847",
                quantity: "0.205"
            }
        ]
    };
    const tinyTop = sizeExactPoolToBook(input);
    assert.equal(tinyTop.admitted, true);
    if (tinyTop.admitted) {
        assert.equal(tinyTop.quote.quantity, "0.185");
        assert.equal(tinyTop.quote.limitSellPriceSwapHive, "0.00506000");
    }
    const belowBuffer = sizeExactPoolToBook({
        ...input,
        bids: input.bids.slice(1)
    });
    assert.equal(belowBuffer.admitted, false);
    if (!belowBuffer.admitted) assert.match(belowBuffer.reason, /not profitable/);
});
test("zero balance and noncanonical pool evidence never produce a quote", ()=>{
    assert.deepEqual(sizeExactPoolToBook({
        ...base,
        balanceSwapHive: "0.00000000"
    }), {
        admitted: false,
        reason: "no admitted SWAP.HIVE capital balance"
    });
    const invalid = sizeExactPoolToBook({
        ...base,
        reserveInSwapHive: "01.00000000"
    });
    assert.equal(invalid.admitted, false);
});

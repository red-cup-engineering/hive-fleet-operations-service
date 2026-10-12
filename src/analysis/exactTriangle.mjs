import { decimalUnits, formatUnits, rationalUnits } from "@red-cup-engineering/exact-number-data-service/decimal-string";
import { exactInputSwapOutput, reserveFraction } from "@red-cup-engineering/hive-blockchain-client-service/engine.mjs";
import { parseEngineOrderBook } from "@red-cup-engineering/hive-blockchain-client-service/market.mjs";
import { marketSellWalk } from "@red-cup-engineering/gaming/market";
import { gradedFromParts, gradedIsZero, gradedValue } from "@red-cup-engineering/exact-number-data-service/graded";
function scale(precision) {
    if (!Number.isSafeInteger(precision) || precision < 0 || precision > 18) throw new Error("precision must be an integer from 0 through 18");
    return 10n ** BigInt(precision);
}
function validatePool(pool) {
    const pairSymbols = pool.pair.split(":");
    if (pairSymbols.length !== 2 || !pairSymbols.includes(pool.inputSymbol) || !pairSymbols.includes(pool.outputSymbol) || pool.inputSymbol === pool.outputSymbol) throw new Error("pool route identity is malformed");
    scale(pool.inputPrecision);
    scale(pool.outputPrecision);
    if (!Number.isSafeInteger(pool.feeBps) || pool.feeBps < 0 || pool.feeBps >= 10_000) throw new Error("pool fee is malformed");
}
export function exactInputPoolOutput(inputUnits, pool) {
    const reserveIn = reserveFraction(pool.reserveIn);
    const reserveOut = reserveFraction(pool.reserveOut);
    if (reserveIn.numerator <= 0n || reserveOut.numerator <= 0n || inputUnits <= 0n) return 0n;
    return exactInputSwapOutput({ reserveIn, reserveOut, quantity: inputUnits, inputScale: scale(pool.inputPrecision), outputScale: scale(pool.outputPrecision), feeBps: pool.feeBps });
}
export function boundedPoolOutput(expected, slippageBps) {
    return expected * BigInt(10_000 - slippageBps) / 10_000n;
}
// The final token's bids as the client reads a Hive-Engine book.
function prepareBids(input) {
    return parseEngineOrderBook(input.bids.map((level)=>({ price: level.priceSwapHivePerToken, quantity: level.quantity })), [], "TOKEN").bids;
}
// Sell `quantity` token units into the bids, highest first.
function sellIntoBids(quantity, bids, tokenPrecision, pricePrecision) {
    const walked = marketSellWalk({ bids, asks: [] }, gradedFromParts(quantity, scale(tokenPrecision), "TOKEN"));
    const units = (value)=>rationalUnits(gradedValue(value), pricePrecision, { rounding: "toward-zero" });
    return Object.freeze({
        proceeds: units(walked.cost),
        limitPrice: walked.worst ? formatUnits(units(walked.worst), pricePrecision) : "0",
        complete: gradedIsZero(walked.shortfall)
    });
}
function quoteAt(inputUnits, input, bids) {
    const firstExpected = exactInputPoolOutput(inputUnits, input.firstPool);
    const firstMinimum = boundedPoolOutput(firstExpected, input.perPoolSlippageBps);
    const secondExpected = exactInputPoolOutput(firstMinimum, input.secondPool);
    const secondMinimum = boundedPoolOutput(secondExpected, input.perPoolSlippageBps);
    if (firstMinimum <= 0n || secondMinimum <= 0n) return null;
    const sale = sellIntoBids(secondMinimum, bids, input.finalTokenPrecision, input.initialPrecision);
    if (!sale.complete || sale.proceeds <= 0n) return null;
    return Object.freeze({
        inputUnits,
        firstExpected,
        firstMinimum,
        secondExpected,
        secondMinimum,
        proceeds: sale.proceeds,
        surplus: sale.proceeds - inputUnits,
        limitPrice: sale.limitPrice
    });
}
export function sizeExactTriangle(input) {
    try {
        validatePool(input.firstPool);
        validatePool(input.secondPool);
        if (input.firstPool.outputSymbol !== input.secondPool.inputSymbol) throw new Error("adjacent route symbols do not compose");
        if (input.firstPool.outputPrecision !== input.secondPool.inputPrecision || input.secondPool.outputPrecision !== input.finalTokenPrecision || input.firstPool.inputPrecision !== input.initialPrecision) throw new Error("adjacent route precisions do not compose");
        if (!input.bidBookComplete) return Object.freeze({
            admitted: false,
            reason: "final bid book is row-limit truncated"
        });
        if (!input.bidBookOrdered) return Object.freeze({
            admitted: false,
            reason: "final bid book is not price-descending"
        });
        if (!Number.isSafeInteger(input.perPoolSlippageBps) || input.perPoolSlippageBps < 0 || input.perPoolSlippageBps > 1_000) {
            return Object.freeze({
                admitted: false,
                reason: "per-pool slippage bound is malformed"
            });
        }
        const balance = decimalUnits(input.initialBalance, input.initialPrecision);
        const cap = BigInt(input.capInitialMilli) * scale(input.initialPrecision) / 1_000n;
        const maximum = balance < cap ? balance : cap;
        if (maximum <= 0n) return Object.freeze({
            admitted: false,
            reason: "no admitted initial capital"
        });
        if (input.bids.length === 0) return Object.freeze({
            admitted: false,
            reason: "final bid depth is unavailable"
        });
        const bids = prepareBids(input);
        const score = (at)=>quoteAt(at, input, bids)?.surplus ?? -(1n << 255n);
        let low = 1n;
        let high = maximum;
        while(high - low > 20_000n){
            const third = (high - low) / 3n;
            const left = low + third;
            const right = high - third;
            if (score(left) <= score(right)) low = left + 1n;
            else high = right - 1n;
        }
        let best = null;
        for(let at = low; at <= high; at += 1n){
            const candidate = quoteAt(at, input, bids);
            if (candidate && (!best || candidate.surplus > best.surplus || candidate.surplus === best.surplus && candidate.inputUnits < best.inputUnits)) best = candidate;
        }
        if (!best || best.surplus <= 0n) return Object.freeze({
            admitted: false,
            reason: "exact bounded triangle has no positive full-fill surplus after fees, precision, slippage, and depth"
        });
        return Object.freeze({
            admitted: true,
            quote: Object.freeze({
                input: formatUnits(best.inputUnits, input.initialPrecision),
                firstExpectedOutput: formatUnits(best.firstExpected, input.firstPool.outputPrecision),
                firstMinimumOutput: formatUnits(best.firstMinimum, input.firstPool.outputPrecision),
                secondExpectedOutput: formatUnits(best.secondExpected, input.secondPool.outputPrecision),
                secondMinimumOutput: formatUnits(best.secondMinimum, input.secondPool.outputPrecision),
                fullFillProceeds: formatUnits(best.proceeds, input.initialPrecision),
                snapshotFullFillSurplus: formatUnits(best.surplus, input.initialPrecision),
                snapshotFullFillEdgeBps: Number(best.surplus * 10_000n / best.inputUnits),
                finalLimitPrice: best.limitPrice,
                finalSellQuantity: formatUnits(best.secondMinimum, input.finalTokenPrecision),
                executionAdmissible: false,
                evidenceGaps: Object.freeze([
                    "three-contract-call-carrier-is-sequential-not-atomic",
                    "final-limit-order-full-fill-is-observed-not-guaranteed",
                    "provider-certified-snapshot-can-change-before-inclusion"
                ])
            })
        });
    } catch (error) {
        return Object.freeze({
            admitted: false,
            reason: `invalid exact triangle evidence: ${error instanceof Error ? error.message : String(error)}`
        });
    }
}

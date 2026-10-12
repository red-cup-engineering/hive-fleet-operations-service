import { decimalUnits, formatUnits } from "@red-cup-engineering/exact-number-data-service/decimal-string";
import { exactOutputSwapInput, reserveFraction } from "@red-cup-engineering/hive-blockchain-client-service/engine.mjs";
function factor(precision) {
    if (!Number.isInteger(precision) || precision < 0 || precision > 18) throw new Error("precision must be an integer from 0 through 18");
    return 10n ** BigInt(precision);
}
// The slippage-bounded maximum input, rounded up.
function withSlippage(input, slippageBps) {
    return (input * BigInt(10_000 + slippageBps) + 9_999n) / 10_000n;
}
function quoteAt(quantity, price, reserveIn, reserveOut, tokenFactor, swapFactor, poolFeeBps, slippageBps) {
    const expectedInput = exactOutputSwapInput({ reserveIn, reserveOut, quantity, tokenScale: tokenFactor, inputScale: swapFactor, feeBps: poolFeeBps });
    if (expectedInput === null) return null;
    const maxInput = withSlippage(expectedInput, slippageBps);
    const proceeds = quantity * price / tokenFactor;
    const expectedProfit = proceeds - expectedInput;
    const worstProfit = proceeds - maxInput;
    if (maxInput <= 0n || worstProfit <= 0n) return null;
    return {
        edgeBps: Number(worstProfit * 10_000n / maxInput),
        expectedInputUnits: expectedInput,
        maxInputUnits: maxInput,
        worstProfitUnits: worstProfit
    };
}
function maximumQuantityWithinCapital(upper, cap, reserveIn, reserveOut, tokenFactor, swapFactor, poolFeeBps, slippageBps) {
    let low = 0n;
    let high = upper;
    while(low < high){
        const middle = (low + high + 1n) / 2n;
        const expectedInput = exactOutputSwapInput({ reserveIn, reserveOut, quantity: middle, tokenScale: tokenFactor, inputScale: swapFactor, feeBps: poolFeeBps });
        if (expectedInput !== null && withSlippage(expectedInput, slippageBps) <= cap) low = middle;
        else high = middle - 1n;
    }
    return low;
}
export function sizeExactPoolToBook(input) {
    if (!input.bidBookComplete) return Object.freeze({
        admitted: false,
        reason: "bid book evidence is row-limit truncated"
    });
    if (!input.bidBookOrdered) return Object.freeze({
        admitted: false,
        reason: "bid book evidence is not price-descending"
    });
    if (!Number.isInteger(input.slippageBps) || input.slippageBps < 0 || input.slippageBps > 10_000) {
        return Object.freeze({
            admitted: false,
            reason: "invalid slippage bound"
        });
    }
    if (!Number.isInteger(input.poolFeeBps) || input.poolFeeBps < 0 || input.poolFeeBps >= 10_000) {
        return Object.freeze({
            admitted: false,
            reason: "invalid pool fee bound"
        });
    }
    try {
        const tokenScale = factor(input.tokenPrecision);
        const swapScale = factor(input.swapHivePrecision);
        const reserveIn = reserveFraction(input.reserveInSwapHive);
        const reserveOut = reserveFraction(input.reserveOutToken);
        const balance = decimalUnits(input.balanceSwapHive, input.swapHivePrecision);
        const capFromPolicy = BigInt(input.capSwapHiveMilli) * swapScale / 1000n;
        const cap = balance < capFromPolicy ? balance : capFromPolicy;
        if (reserveIn.numerator <= 0n || reserveOut.numerator <= 0n) return Object.freeze({
            admitted: false,
            reason: "exact positive pool reserves unavailable"
        });
        if (cap <= 0n) return Object.freeze({
            admitted: false,
            reason: "no admitted SWAP.HIVE capital balance"
        });
        if (input.bids.length === 0) return Object.freeze({
            admitted: false,
            reason: "exact bid depth unavailable"
        });
        let priorPrice = null;
        let cumulative = 0n;
        let best = null;
        for (const level of input.bids){
            const price = decimalUnits(level.priceSwapHivePerToken, input.swapHivePrecision);
            const levelQuantity = decimalUnits(level.quantity, input.tokenPrecision);
            if (price <= 0n || levelQuantity <= 0n) throw new Error("book level must be positive");
            if (priorPrice !== null && price > priorPrice) throw new Error("bid prices are not descending");
            priorPrice = price;
            cumulative += levelQuantity;
            const reserveOutFloor = reserveOut.numerator * tokenScale / reserveOut.denominator;
            const reserveExactlyOnTokenUnit = reserveOut.numerator * tokenScale % reserveOut.denominator === 0n;
            const maximumBelowReserve = reserveExactlyOnTokenUnit ? reserveOutFloor - 1n : reserveOutFloor;
            const upper = cumulative < maximumBelowReserve ? cumulative : maximumBelowReserve;
            const quantity = maximumQuantityWithinCapital(upper, cap, reserveIn, reserveOut, tokenScale, swapScale, input.poolFeeBps, input.slippageBps);
            const evaluated = quoteAt(quantity, price, reserveIn, reserveOut, tokenScale, swapScale, input.poolFeeBps, input.slippageBps);
            if (!evaluated || evaluated.maxInputUnits > cap) continue;
            const quote = Object.freeze({
                quantity: formatUnits(quantity, input.tokenPrecision),
                expectedInputSwapHive: formatUnits(evaluated.expectedInputUnits, input.swapHivePrecision),
                maxInputSwapHive: formatUnits(evaluated.maxInputUnits, input.swapHivePrecision),
                limitSellPriceSwapHive: formatUnits(price, input.swapHivePrecision),
                minimumProceedsSwapHive: formatUnits(quantity * price / tokenScale, input.swapHivePrecision),
                expectedProfitSwapHive: formatUnits(quantity * price / tokenScale - evaluated.expectedInputUnits, input.swapHivePrecision),
                worstCaseProfitSwapHive: formatUnits(evaluated.worstProfitUnits, input.swapHivePrecision),
                edgeBps: evaluated.edgeBps
            });
            if (!best || evaluated.worstProfitUnits > best.worst || evaluated.worstProfitUnits === best.worst && evaluated.maxInputUnits < best.maxInput) {
                best = {
                    quote,
                    worst: evaluated.worstProfitUnits,
                    maxInput: evaluated.maxInputUnits
                };
            }
        }
        return best ? Object.freeze({
            admitted: true,
            quote: best.quote
        }) : Object.freeze({
            admitted: false,
            reason: "bounded round trip is not profitable after exact depth, precision, and slippage"
        });
    } catch (error) {
        return Object.freeze({
            admitted: false,
            reason: `invalid exact market evidence: ${error instanceof Error ? error.message : String(error)}`
        });
    }
}

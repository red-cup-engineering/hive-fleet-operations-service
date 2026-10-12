import { decimalUnits, formatUnits, rationalUnits } from "@red-cup-engineering/exact-number-data-service/decimal-string";
import { gradedFromParts, gradedSign, gradedValue } from "@red-cup-engineering/exact-number-data-service/graded";
import { parseEngineOrderBook } from "@red-cup-engineering/hive-blockchain-client-service/market.mjs";
import { marketBuyWalk, marketSellWalk } from "@red-cup-engineering/gaming/market";
function validateBps(value, label) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) throw new TypeError(`${label} is malformed`);
}
export function planIncomeTokenAcquisition(input) {
    try {
        if (!/^[A-Z][A-Z0-9.]{0,19}$/u.test(input.symbol) || input.symbol === "SWAP.HIVE") throw new TypeError("income-token symbol is malformed");
        if (!Number.isSafeInteger(input.tokenPrecision) || input.tokenPrecision < 0 || input.tokenPrecision > 8) throw new TypeError("income-token precision is malformed");
        for (const [label, value] of Object.entries(input.policy).filter(([, value])=>typeof value === "number"))validateBps(Number(value), label);
        const tokenScale = 10n ** BigInt(input.tokenPrecision);
        const purchase = decimalUnits(input.purchaseQuantity, input.tokenPrecision);
        const balance = decimalUnits(input.swapHiveBalance, 8);
        const existing = decimalUnits(input.existingFleetQuantity, input.tokenPrecision);
        const maximumSpend = decimalUnits(input.policy.maximumSpendSwapHive, 8);
        const reserve = decimalUnits(input.policy.minimumSwapHiveReserve, 8);
        const annualMicros = decimalUnits(input.annualizedNativeHive, 6);
        const annualHolding = decimalUnits(input.annualizedHoldingQuantity, input.tokenPrecision);
        const minimumFeeMilli = decimalUnits(input.policy.hiveDepositMinimumFee, 3);
        if (purchase <= 0n || existing <= 0n || annualMicros <= 0n || annualHolding <= 0n) throw new TypeError("income-token quantity or cashflow evidence is empty");
        const fleet = new Set(input.fleetAccounts);
        const normalize = (level)=>{
            if (!/^[a-z][a-z0-9.-]{2,15}$/u.test(level.account) || !/^[0-9a-f]{40}(?:-[0-9]+)?$/u.test(level.orderId)) throw new TypeError("order identity is malformed");
            const price = decimalUnits(level.price, 8);
            const quantity = decimalUnits(level.quantity, input.tokenPrecision);
            if (price <= 0n || quantity <= 0n) throw new TypeError("order economics are not positive");
            return Object.freeze({
                ...level,
                priceUnits: price,
                quantityUnits: quantity
            });
        };
        const asks = input.asks.map(normalize);
        const bids = input.bids.map(normalize);
        if (asks.length === 0 || bids.length === 0) return Object.freeze({
            admitted: false,
            reason: "two-sided executable depth is unavailable"
        });
        // Buy the quantity from the asks, lowest first; the worst price reached is the limit.
        const units8 = (value)=>rationalUnits(gradedValue(value), 8, { rounding: "toward-zero" });
        const book = parseEngineOrderBook(input.bids, input.asks, input.symbol);
        const buy = marketBuyWalk(book, gradedFromParts(purchase, tokenScale, input.symbol));
        if (gradedSign(buy.shortfall) > 0) return Object.freeze({
            admitted: false,
            reason: "displayed asks cannot fill the pilot quantity"
        });
        const limitPrice = units8(buy.worst);
        const expectedCost = units8(buy.cost);
        if (asks.some((ask)=>fleet.has(ask.account) && ask.priceUnits <= limitPrice)) return Object.freeze({
            admitted: false,
            reason: "acquisition would cross a fleet-owned ask"
        });
        const maximumEscrow = purchase * limitPrice / tokenScale;
        if (maximumEscrow > maximumSpend) return Object.freeze({
            admitted: false,
            reason: "pilot exceeds the absolute SWAP.HIVE spend cap"
        });
        if (balance - maximumEscrow < reserve) return Object.freeze({
            admitted: false,
            reason: "pilot breaches the liquid SWAP.HIVE reserve"
        });
        if (maximumEscrow * 10_000n > balance * BigInt(input.policy.maximumLiquidCapitalBps)) return Object.freeze({
            admitted: false,
            reason: "pilot exceeds the liquid-capital allocation cap"
        });
        const exposureGrowthBps = Number(purchase * 10_000n / existing);
        if (exposureGrowthBps > input.policy.maximumExposureGrowthBps) return Object.freeze({
            admitted: false,
            reason: "pilot exceeds the fleet exposure-growth cap"
        });
        // Exit the same quantity into the bids, highest first.
        const sell = marketSellWalk(book, gradedFromParts(purchase, tokenScale, input.symbol));
        if (gradedSign(sell.shortfall) > 0) return Object.freeze({
            admitted: false,
            reason: "displayed bids cannot exit the pilot quantity"
        });
        const exit = units8(sell.cost);
        const drawdownBps = maximumEscrow <= exit ? 0 : Number((maximumEscrow - exit) * 10_000n / maximumEscrow);
        if (drawdownBps > input.policy.maximumImmediateDrawdownBps) return Object.freeze({
            admitted: false,
            reason: "pilot principal drawdown exceeds policy"
        });
        const annualPerPurchaseMicros = annualMicros * purchase / annualHolding;
        const retainedMicros = annualPerPurchaseMicros * BigInt(input.policy.incomeRetentionBps) / 10_000n;
        const retainedMilli = retainedMicros / 1_000n;
        const percentageFee = (retainedMilli * BigInt(input.policy.hiveDepositFeeBps) + 9_999n) / 10_000n;
        const feeMilli = percentageFee > minimumFeeMilli ? percentageFee : minimumFeeMilli;
        const outputMilli = retainedMilli > feeMilli ? retainedMilli - feeMilli : 0n;
        const outputSwapUnits = outputMilli * 100_000n;
        const yieldBps = maximumEscrow === 0n ? 0 : Number(outputSwapUnits * 10_000n / maximumEscrow);
        if (yieldBps < input.policy.minimumHaircuttedYieldBps) return Object.freeze({
            admitted: false,
            reason: "fee-bounded haircutted historical yield is below policy"
        });
        return Object.freeze({
            admitted: true,
            quote: Object.freeze({
                symbol: input.symbol,
                quantity: formatUnits(purchase, input.tokenPrecision),
                limitPriceSwapHive: formatUnits(limitPrice, 8),
                expectedDisplayedCostSwapHive: formatUnits(expectedCost, 8),
                maximumEscrowSwapHive: formatUnits(maximumEscrow, 8),
                immediateDisplayedExitSwapHive: formatUnits(exit, 8),
                immediateDrawdownBps: drawdownBps,
                exposureGrowthBps,
                historicalAnnualNativeHivePerPurchase: formatUnits(annualPerPurchaseMicros, 6),
                haircuttedAnnualNativeHive: formatUnits(retainedMilli, 3),
                feeBoundedAnnualSwapHiveOutput: formatUnits(outputSwapUnits, 8),
                haircuttedYieldBps: yieldBps,
                executionAdmissible: false,
                evidenceGaps: Object.freeze([
                    "historical-distribution-run-rate-is-not-guaranteed",
                    "future-holder-distributions-are-not-yet-settled",
                    "deployed-deposit-mechanics-do-not-prove-reserves-or-market-peg",
                    "limit-order-can-partially-fill-or-rest-until-expiration"
                ])
            })
        });
    } catch (error) {
        return Object.freeze({
            admitted: false,
            reason: `invalid income-token acquisition evidence: ${error instanceof Error ? error.message : String(error)}`
        });
    }
}

import assert from "node:assert/strict";
import test from "node:test";
import { planIncomeTokenAcquisition } from "../src/analysis/incomeTokenAcquisition.mjs";
const input = Object.freeze({
    symbol: "EDSI",
    tokenPrecision: 3,
    purchaseQuantity: "1.000",
    swapHiveBalance: "71.69561429",
    existingFleetQuantity: "89.568",
    annualizedNativeHive: "11.626333",
    annualizedHoldingQuantity: "89.568",
    asks: Object.freeze([
        {
            account: "seller-one",
            quantity: "0.250",
            price: "1.01111100",
            orderId: "1".repeat(40)
        },
        {
            account: "seller-two",
            quantity: "0.250",
            price: "1.01499000",
            orderId: "2".repeat(40)
        },
        {
            account: "seller-three",
            quantity: "7.152",
            price: "1.01555000",
            orderId: "3".repeat(40)
        }
    ]),
    bids: Object.freeze([
        {
            account: "buyer-one",
            quantity: "100.000",
            price: "1.00000000",
            orderId: "4".repeat(40)
        }
    ]),
    fleetAccounts: Object.freeze([
        "michael561",
        "emsenn0"
    ]),
    policy: Object.freeze({
        maximumSpendSwapHive: "1.02000000",
        minimumSwapHiveReserve: "70.00000000",
        maximumLiquidCapitalBps: 150,
        maximumExposureGrowthBps: 200,
        minimumHaircuttedYieldBps: 500,
        maximumImmediateDrawdownBps: 500,
        incomeRetentionBps: 5000,
        hiveDepositFeeBps: 75,
        hiveDepositMinimumFee: "0.001"
    })
});
test("exact EDSI pilot survives haircut, deposit fee, depth, reserve, and drawdown", ()=>{
    const result = planIncomeTokenAcquisition(input);
    assert.equal(result.admitted, true);
    if (!result.admitted) return;
    assert.equal(result.quote.expectedDisplayedCostSwapHive, "1.01430025");
    assert.equal(result.quote.maximumEscrowSwapHive, "1.01555000");
    assert.equal(result.quote.haircuttedAnnualNativeHive, "0.064");
    assert.equal(result.quote.feeBoundedAnnualSwapHiveOutput, "0.06300000");
    assert.equal(result.quote.haircuttedYieldBps, 620);
    assert.equal(result.quote.executionAdmissible, false);
    assert.ok(result.quote.evidenceGaps.includes("future-holder-distributions-are-not-yet-settled"));
});
test("acquisition fails closed on self-cross, capital, concentration, yield, and exit depth", ()=>{
    assert.equal(planIncomeTokenAcquisition({
        ...input,
        asks: [
            {
                ...input.asks[0],
                account: "michael561",
                quantity: "1.000"
            }
        ]
    }).admitted, false);
    assert.equal(planIncomeTokenAcquisition({
        ...input,
        swapHiveBalance: "1.50000000"
    }).admitted, false);
    assert.equal(planIncomeTokenAcquisition({
        ...input,
        existingFleetQuantity: "1.000"
    }).admitted, false);
    assert.equal(planIncomeTokenAcquisition({
        ...input,
        annualizedNativeHive: "1.000000"
    }).admitted, false);
    assert.equal(planIncomeTokenAcquisition({
        ...input,
        bids: [
            {
                ...input.bids[0],
                quantity: "0.999"
            }
        ]
    }).admitted, false);
});

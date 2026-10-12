import assert from "node:assert/strict";
import test from "node:test";
import { ASSET_YIELD_SCHEMA, recordAssetYield } from "../src/core/assetYieldSettlement.mjs";
test("asset-yield settlement rejects any broad or unconfirmed identity", async ()=>{
    const base = {
        kind: "aagaard.asset-yield-receipt",
        account: "michael561",
        symbol: "WORKERBEE",
        transactionId: "a".repeat(40),
        status: "yield-delegation-confirmed"
    };
    await assert.rejects(recordAssetYield("/tmp/not-used", {
        ...base,
        account: "emsenn0"
    }), /not recordable/);
    await assert.rejects(recordAssetYield("/tmp/not-used", {
        ...base,
        symbol: "ZING"
    }), /not recordable/);
    await assert.rejects(recordAssetYield("/tmp/not-used", {
        ...base,
        status: "observed"
    }), /not recordable/);
    assert.equal(ASSET_YIELD_SCHEMA, "aagaard.asset-yield.v1");
});

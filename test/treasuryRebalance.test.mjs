import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { engineCustomJson, pools, tokens } from "@red-cup-engineering/hive-blockchain-client-service/engine.mjs";
// The signer must never find a real key under test.
process.env.HIVE_KEY_ROOT = "/nonexistent-hive-key-root";
const BROADCASTER = new URL("../scripts/hive-broadcast.mjs", import.meta.url).pathname;
function request(quantity = "10.00000000") {
    return {
        kind: "aagaard.hive-write",
        account: "michael561",
        role: "active",
        lane: "treasury-rebalance",
        target: "sigmund-vexler:arbitrage-capital",
        operation: engineCustomJson("michael561", tokens.transfer({ to: "sigmund-vexler", symbol: "SWAP.HIVE", quantity, memo: "AGRODAO shared allocator: Sigmund arbitrage float" }))
    };
}
function feeRequest(quantity = "0.0100") {
    return {
        kind: "aagaard.hive-write",
        account: "michael561",
        role: "active",
        lane: "treasury-rebalance",
        target: "sigmund-vexler:arbitrage-fees",
        operation: engineCustomJson("michael561", tokens.transfer({ to: "sigmund-vexler", symbol: "BEED", quantity, memo: "AGRODAO shared allocator: Sigmund arbitrage BEED fees" }))
    };
}
function sign(input) {
    return spawnSync(process.execPath, [
        BROADCASTER
    ], {
        input: JSON.stringify(input),
        encoding: "utf8"
    }).stdout;
}
test("the signer moves tokens between fleet accounts, any amount or memo", ()=>{
    assert.match(sign(request()), /key-unavailable/u);
    assert.match(sign(request("10.00000001")), /key-unavailable/u);
    assert.match(sign(feeRequest()), /key-unavailable/u);
});
test("the signer refuses sending tokens outside the fleet", ()=>{
    const outside = {
        ...request(),
        operation: engineCustomJson("michael561", tokens.transfer({ to: "someone-outside", symbol: "SWAP.HIVE", quantity: "1.00000000", memo: "" }))
    };
    assert.match(sign(outside), /tokens move only between fleet accounts/u);
});

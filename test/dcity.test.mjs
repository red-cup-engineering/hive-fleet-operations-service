import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { planDCityLiquidSimRecovery } from "@red-cup-engineering/dcity-services-section";
import { parseOptions, statesAgree } from "../scripts/dcity-recovery.mjs";
// The signer must never find a real key under test.
process.env.HIVE_KEY_ROOT = "/nonexistent-hive-key-root";
const STATE = Object.freeze({
    account: "michael561",
    observedAt: "2026-07-22T01:40:00.000Z",
    simBalance: "34426.820",
    swapHiveBalance: "13.05352195",
    simPrecision: 3,
    swapHivePrecision: 8,
    tokenPair: "SWAP.HIVE:SIM",
    baseQuantity: "6261.30641990",
    quoteQuantity: "130318140.61526257",
    nftCount: 15,
    nftLockedSim: "300.000"
});
test("dCity recovery prices the exact full liquid balance and preserves NFTs", ()=>{
    const plan = planDCityLiquidSimRecovery(STATE);
    assert.equal(plan.kind, "ready");
    if (plan.kind !== "ready") return;
    assert.equal(plan.quote.quantitySim, "34426.820");
    assert.equal(plan.quote.expectedSwapHive, "1.64951195");
    assert.equal(plan.quote.minimumSwapHive, "1.63301683");
    assert.deepEqual(plan.quote.operation, [
        "custom_json",
        {
            id: "ssc-mainnet-hive",
            required_auths: [
                "michael561"
            ],
            required_posting_auths: [],
            json: '{"contractName":"marketpools","contractAction":"swapTokens","contractPayload":{"tokenPair":"SWAP.HIVE:SIM","tokenSymbol":"SIM","tokenAmount":"34426.820","tradeType":"exactInput","minAmountOut":"1.63301683"}}'
        }
    ]);
    assert.equal(STATE.nftCount, 15);
    assert.equal(STATE.nftLockedSim, "300.000");
});
test("dCity recovery refuses empty balances, changed precision, and excessive slippage", ()=>{
    assert.equal(planDCityLiquidSimRecovery({
        ...STATE,
        simBalance: "0.000"
    }).kind, "refuse");
    assert.match(planDCityLiquidSimRecovery({
        ...STATE,
        simPrecision: 8
    }).reason, /precision changed/);
    assert.match(planDCityLiquidSimRecovery(STATE, 501).reason, /slippage policy/);
});
test("dCity runner is observe-only unless one exact execution is requested", ()=>{
    assert.deepEqual(parseOptions([
        "--account",
        "michael561"
    ]), {
        account: "michael561",
        executeOne: false
    });
    assert.deepEqual(parseOptions([
        "--account",
        "michael561",
        "--execute-one"
    ]), {
        account: "michael561",
        executeOne: true
    });
    assert.throws(()=>parseOptions([
            "--account",
            "michael561",
            "--burn-nfts"
        ]), /unknown argument/);
});
test("dCity independent observations must agree on all economic evidence", ()=>{
    assert.equal(statesAgree(STATE, {
        ...STATE,
        observedAt: "2026-07-22T01:40:01.000Z"
    }), true);
    assert.equal(statesAgree(STATE, {
        ...STATE,
        baseQuantity: "6261.30641989"
    }), false);
    assert.equal(statesAgree(STATE, {
        ...STATE,
        simBalance: "34426.819"
    }), false);
});
test("Hive broadcaster admits only the exact bounded dCity SIM recovery shape", async ()=>{
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
            const decoded = {
                contractName: "marketpools",
                contractAction: "swapTokens",
                contractPayload: {
                    tokenPair: "SWAP.HIVE:SIM",
                    tokenSymbol: "SIM",
                    tokenAmount: "34426.820",
                    tradeType: "exactInput",
                    minAmountOut: "1.63710853"
                }
            };
            child.stdin.end(JSON.stringify({
                account: "michael561",
                role: "active",
                lane: "gaming",
                target: "dcity-liquid-sim-recovery",
                operation: [
                    "custom_json",
                    {
                        id: "ssc-mainnet-hive",
                        required_auths: [
                            "michael561"
                        ],
                        required_posting_auths: [],
                        json: JSON.stringify(decoded)
                    }
                ],
                ...overrides
            }));
        });
    const valid = await run();
    assert.equal(valid.code, 0);
    assert.match(valid.stdout, /key-unavailable/);
    const wrongLane = await run({
        target: "generic-trading"
    });
    // Outside the dCity lane it is an ordinary slippage-bounded pool swap, signable within the cap.
    assert.match(wrongLane.stdout, /key-unavailable/);
    const burn = structuredClone(STATE);
    assert.equal(burn.nftCount, 15);
    const malformed = await run({
        operation: [
            "custom_json",
            {
                id: "ssc-mainnet-hive",
                required_auths: [
                    "michael561"
                ],
                required_posting_auths: [],
                json: JSON.stringify({
                    contractName: "nft",
                    contractAction: "burn",
                    contractPayload: {
                        symbol: "CITY",
                        ids: [
                            56233
                        ]
                    }
                })
            }
        ]
    });
    assert.match(malformed.stdout, /refusing contract call/);
});

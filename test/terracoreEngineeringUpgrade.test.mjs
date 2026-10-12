import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { terraCoreEngineeringUpgradeIntent } from "@red-cup-engineering/terracore-services-section";
import { engineStatesAgree, parseOptions, parseUpgradeTransaction } from "../scripts/terracore-engineering-upgrade.mjs";
// The signer must never find a real key under test.
process.env.HIVE_KEY_ROOT = "/nonexistent-hive-key-root";
const BROADCASTER = new URL("../scripts/hive-broadcast.mjs", import.meta.url);
function runBroadcaster(request) {
    return new Promise((resolvePromise, rejectPromise)=>{
        const child = spawn(process.execPath, [
            BROADCASTER.pathname
        ], {
            stdio: [
                "pipe",
                "pipe",
                "pipe"
            ]
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk)=>{
            stdout += String(chunk);
        });
        child.stdout.on("data", (chunk)=>{
            stderr += String(chunk);
        });
        child.on("error", rejectPromise);
        child.on("close", (code)=>resolvePromise(Object.freeze({
                code,
                stdout,
                stderr
            })));
        child.stdin.end(JSON.stringify(request));
    });
}
test("TerraCore Engineering operator is one explicit active-key action", ()=>{
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
        "--key-file",
        "/private/active.wif",
        "--execute-one"
    ]), {
        account: "michael561",
        executeOne: true
    });
    assert.throws(()=>parseOptions([
            "--account",
            "michael561",
            "--execute-one"
        ]), /requires --key-file/);
    assert.throws(()=>parseOptions([
            "--account",
            "michael561",
            "--level",
            "16"
        ]), /unknown argument/);
});
test("TerraCore Engineering receipt requires the exact SCRAP burn event", ()=>{
    const memo = "terracore_engineering-0123456789abcdef";
    const row = {
        transactionId: `${"a".repeat(40)}-0`,
        blockNumber: 61300000,
        sender: "michael561",
        contract: "tokens",
        action: "transfer",
        payload: JSON.stringify({
            symbol: "SCRAP",
            to: "null",
            quantity: "196.00000000",
            memo,
            isSignedWithActiveKey: true
        }),
        logs: JSON.stringify({
            events: [
                {
                    contract: "tokens",
                    event: "transfer",
                    data: {
                        from: "michael561",
                        to: "null",
                        symbol: "SCRAP",
                        quantity: "196.00000000"
                    }
                }
            ],
            errors: []
        })
    };
    assert.equal(parseUpgradeTransaction(row, "michael561", "196.00000000", memo).quantity, "196.00000000");
    assert.throws(()=>parseUpgradeTransaction({
            ...row,
            sender: "other-user"
        }, "michael561", "196.00000000", memo), /exact active-authorized/);
    assert.throws(()=>parseUpgradeTransaction({
            ...row,
            logs: JSON.stringify({
                events: []
            })
        }, "michael561", "196.00000000", memo), /lacks the exact/);
    assert.equal(engineStatesAgree({
        liquidScrap: "289.44439576",
        scrapPrecision: 8
    }, {
        liquidScrap: "289.44439576",
        scrapPrecision: 8
    }), true);
});
test("broadcaster admits only the exact TerraCore Engineering upgrade lane and envelope", async ()=>{
    const intent = terraCoreEngineeringUpgradeIntent("michael561", "196.00000000", "0123456789abcdef");
    const request = {
        account: "michael561",
        role: "active",
        lane: "gaming",
        target: "terracore-engineering-upgrade",
        operation: intent.operation
    };
    const admitted = await runBroadcaster(request);
    assert.equal(admitted.code, 1);
    assert.match(admitted.stdout, /key-unavailable/);
    assert.doesNotMatch(admitted.stdout, /refusing contract call|must be one bounded/);
    const fields = intent.operation[1];
    const decoded = JSON.parse(fields.json);
    const wrongMemo = await runBroadcaster({
        ...request,
        operation: [
            "custom_json",
            {
                ...fields,
                json: JSON.stringify({
                    ...decoded,
                    contractPayload: {
                        ...decoded.contractPayload,
                        memo: "terracore_damage-0123456789abcdef"
                    }
                })
            }
        ]
    });
    assert.equal(wrongMemo.code, 1);
    assert.match(wrongMemo.stderr, /must be one bounded exact SCRAP-to-null transfer/);
    const wrongLane = await runBroadcaster({
        ...request,
        target: "terracore-one-action"
    });
    assert.equal(wrongLane.code, 1);
    assert.match(wrongLane.stdout, /refusing contract call 'tokens\.transfer'/);
});

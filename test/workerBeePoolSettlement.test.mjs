import assert from "node:assert/strict";
import test from "node:test";
import { readWorkerBeePoolDistributions, recordWorkerBeePoolDistributions } from "../src/core/workerBeePoolSettlement.mjs";
import { reconcileWorkerBeePoolDistribution } from "@red-cup-engineering/workerbee-services-section/pool";
import { workerBeePoolTransfersFromHistoryRow } from "@red-cup-engineering/workerbee-services-section/pool";
import { parseOptions } from "../scripts/workerbee-pool-audit.mjs";
const DELEGATED_AT = "2026-07-22T06:31:42.000Z";
const TX = "a".repeat(40);
function historyRow(timestamp = "2026-07-22T07:00:00") {
    return [
        42,
        {
            block: 108_350_000,
            trx_id: TX,
            timestamp,
            op: [
                "custom_json",
                {
                    id: "ssc-mainnet-hive",
                    required_auths: [
                        "ph1102"
                    ],
                    required_posting_auths: [],
                    json: JSON.stringify({
                        contractName: "tokens",
                        contractAction: "transfer",
                        contractPayload: {
                            symbol: "BEE",
                            to: "michael561",
                            quantity: "0.02500000",
                            memo: ""
                        }
                    })
                }
            ]
        }
    ];
}
function engineResult(quantity = "0.02500000") {
    return {
        blockNumber: 61_400_000,
        refHiveBlockNumber: 108_350_000,
        transactionId: TX,
        sender: "ph1102",
        contract: "tokens",
        action: "transfer",
        payload: JSON.stringify({
            symbol: "BEE",
            to: "michael561",
            quantity,
            memo: "",
            isSignedWithActiveKey: true
        }),
        logs: JSON.stringify({
            events: [
                {
                    contract: "tokens",
                    event: "transfer",
                    data: {
                        from: "ph1102",
                        to: "michael561",
                        symbol: "BEE",
                        quantity
                    }
                }
            ]
        })
    };
}
test("pool transfer parsing binds source, beneficiary, delegation time, and narrow action", ()=>{
    const candidates = workerBeePoolTransfersFromHistoryRow(historyRow(), DELEGATED_AT, "michael561");
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.sourceId, `hive:${TX}:0`);
    assert.equal(candidates[0]?.quantity, "0.02500000");
    assert.equal(workerBeePoolTransfersFromHistoryRow(historyRow("2026-07-22T06:00:00"), DELEGATED_AT, "michael561").length, 0);
    const foreign = structuredClone(historyRow());
    foreign[1].op[1].json = JSON.stringify([
        {
            contractName: "tokens",
            contractAction: "transfer",
            contractPayload: {
                symbol: "BEE",
                to: "michael561",
                quantity: "0.02500000"
            }
        },
        {
            contractName: "market",
            contractAction: "sell",
            contractPayload: {}
        }
    ]);
    assert.equal(workerBeePoolTransfersFromHistoryRow(foreign, DELEGATED_AT, "michael561").length, 0);
});
test("expected yield becomes settled only with two exact execution witnesses", ()=>{
    const candidate = workerBeePoolTransfersFromHistoryRow(historyRow(), DELEGATED_AT, "michael561")[0];
    assert.throws(()=>reconcileWorkerBeePoolDistribution(candidate, [
            {
                provider: "one",
                result: engineResult()
            }
        ]), /fewer than two/u);
    assert.throws(()=>reconcileWorkerBeePoolDistribution(candidate, [
            {
                provider: "one",
                result: engineResult()
            },
            {
                provider: "two",
                result: engineResult("0.02400000")
            }
        ]), /fewer than two/u);
    const settled = reconcileWorkerBeePoolDistribution(candidate, [
        {
            provider: "one",
            result: engineResult()
        },
        {
            provider: "two",
            result: engineResult()
        }
    ]);
    assert.equal(settled.status, "settled");
    assert.deepEqual(settled.confirmationProviders, [
        "one",
        "two"
    ]);
});
test("settled pool distributions project idempotently without inventing valuation", async ()=>{
    const candidate = workerBeePoolTransfersFromHistoryRow(historyRow(), DELEGATED_AT, "michael561")[0];
    const settled = reconcileWorkerBeePoolDistribution(candidate, [
        {
            provider: "one",
            result: engineResult()
        },
        {
            provider: "two",
            result: engineResult()
        }
    ]);
    const first = await recordWorkerBeePoolDistributions("/tmp/not-used", [
        settled
    ]);
    const second = await recordWorkerBeePoolDistributions("/tmp/not-used", [
        settled
    ]);
    assert.equal(first.length, 1);
    assert.equal(first[0]?.eventId, second[0]?.eventId);
    assert.equal(first[0]?.valuation.swapHive, null);
    await assert.rejects(readWorkerBeePoolDistributions("/tmp/not-used"), /chain-derived|Hive Engine/);
});
test("pool audit has no credential, arbitrary account, or mutation surface", ()=>{
    assert.deepEqual(parseOptions([
        "--account",
        "michael561"
    ]), {
        account: "michael561",
        record: false
    });
    assert.deepEqual(parseOptions([
        "--account",
        "michael561",
        "--record"
    ]), {
        account: "michael561",
        record: true
    });
    assert.throws(()=>parseOptions([
            "--account",
            "emsenn0"
        ]), /runs this lane \(michael561\)/u);
    assert.throws(()=>parseOptions([
            "--account",
            "michael561",
            "--key-file",
            "secret"
        ]), /unknown argument/u);
});

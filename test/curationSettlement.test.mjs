import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readRewardRoutes } from "../src/analysis/reward.mjs";
import { readCurationTelemetry, recordCurationPredictions, recordCurationSettlements } from "../src/core/curationSettlement.mjs";
import { createHiveClient, curationRewardFromHistoryRow } from "../src/integrations/hive/hive.adapter.mjs";
function post(beneficiaryWeight) {
    return Object.freeze({
        author: "writer",
        permlink: `post-${beneficiaryWeight}`,
        title: "post",
        body: "body",
        tags: Object.freeze([
            "hive"
        ]),
        pendingPayout: 1,
        netRshares: 100,
        comments: 0,
        ageHours: 1,
        created: "2026-07-13T00:00:00.000Z",
        beneficiaries: beneficiaryWeight === 0 ? Object.freeze([]) : Object.freeze([
            Object.freeze({
                account: "beneficiary",
                weight: beneficiaryWeight
            })
        ]),
        votes: Object.freeze([])
    });
}
test("author beneficiaries do not reduce curator capture efficiency", ()=>{
    const without = post(0);
    const withNinetyPercent = post(9000);
    const routes = readRewardRoutes([
        without,
        withNinetyPercent
    ]);
    assert.equal(routes.get("writer/post-0")?.beneficiaryFraction, 0);
    assert.equal(routes.get("writer/post-9000")?.beneficiaryFraction, 0.9);
    assert.equal(routes.get("writer/post-0")?.captureEfficiency, routes.get("writer/post-9000")?.captureEfficiency);
});
function historyRow(historyIndex, block, amount) {
    return [
        historyIndex,
        {
            op: [
                "curation_reward",
                {
                    author: "writer",
                    reward: `${amount} VESTS`,
                    curator: "michael561",
                    permlink: "measured-post",
                    payout_must_be_claimed: true
                }
            ],
            block,
            trx_id: "0000000000000000000000000000000000000000",
            op_in_trx: 0,
            timestamp: "2026-07-20T12:00:00",
            virtual_op: true,
            trx_in_block: 4294967295
        }
    ];
}
test("curation_reward parsing uses account-history position, not the virtual transaction id", ()=>{
    const first = curationRewardFromHistoryRow("michael561", historyRow(219, 108_300_001, "1.653817"));
    const second = curationRewardFromHistoryRow("michael561", historyRow(220, 108_300_002, "0.000001"));
    assert.equal(first?.timestamp, "2026-07-20T12:00:00Z");
    assert.equal(first?.reward.amount, "1.653817");
    assert.equal(first?.reward.asset, "VESTS");
    assert.notEqual(first?.sourceId, second?.sourceId);
    assert.doesNotMatch(first?.sourceId ?? "", /0000000000000000000000000000000000000000/);
});
test("Hive client obtains a bounded newest account-history scan", async ()=>{
    const requests = [];
    const fetchImpl = async (_input, init)=>{
        requests.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: [
                historyRow(219, 108_300_001, "1.653817")
            ]
        }), {
            status: 200,
            headers: {
                "content-type": "application/json"
            }
        });
    };
    const hive = createHiveClient({
        nodes: [
            "https://example.invalid"
        ],
        timeoutMs: 1000,
        perSourceLimit: 1,
        fetch: fetchImpl
    });
    const scan = await hive.readCurationRewards({
        account: "michael561"
    });
    assert.equal(requests[0]?.method, "condenser_api.get_account_history");
    assert.deepEqual(requests[0]?.params, [
        "michael561",
        -1,
        1000
    ]);
    assert.equal(scan.requestedLimit, 1000);
    assert.equal(scan.newestHistoryIndex, 219);
    assert.equal(scan.rewards.length, 1);
});
test("settled vote lots preserve proxy predictions beside exact VESTS without inventing valuation", async ()=>{
    const root = mkdtempSync(path.join(tmpdir(), "aagaard-curation-lot-"));
    try {
        const vote = Object.freeze({
            author: "writer",
            permlink: "measured-post",
            weightBps: 2500,
            expectedCurationHbd: "0.500000",
            reason: "fixture"
        });
        const execution = Object.freeze({
            broadcast: 1,
            dryRun: 0,
            skipped: 0,
            errors: 0,
            receipts: Object.freeze([
                Object.freeze({
                    lane: "voting",
                    action: "vote",
                    target: "writer/measured-post",
                    status: "broadcast",
                    role: "posting",
                    txId: "real-vote-transaction"
                })
            ])
        });
        const predictions = await recordCurationPredictions(root, "michael561", [
            vote
        ], execution, "2026-07-13T12:00:00.000Z");
        assert.equal(predictions.length, 1);
        const reward = curationRewardFromHistoryRow("michael561", historyRow(219, 108_300_001, "1.653817"));
        assert.ok(reward);
        const scan = Object.freeze({
            kind: "aagaard.hive-curation-reward-scan",
            account: "michael561",
            requestedLimit: 1000,
            newestHistoryIndex: 219,
            oldestHistoryIndex: 0,
            rewards: Object.freeze([
                reward
            ])
        });
        const first = await recordCurationSettlements(root, scan, "2026-07-20T12:01:00.000Z");
        const duplicate = await recordCurationSettlements(root, scan, "2026-07-20T12:02:00.000Z");
        assert.equal(first.length, 1);
        assert.equal(first[0]?.matchedExpectedCurationHbd, vote.expectedCurationHbd);
        assert.equal(first[0]?.valuation.hbd, null);
        assert.equal(duplicate.length, 0);
    } finally{
        rmSync(root, {
            recursive: true,
            force: true
        });
    }
});

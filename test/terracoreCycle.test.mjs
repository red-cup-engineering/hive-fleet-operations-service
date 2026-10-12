import assert from "node:assert/strict";
import test from "node:test";
import { balancesAgree, findNewBattleLog, parseOptions, reconcileClaimBalances, settlementPendingReceipt } from "../scripts/terracore-cycle.mjs";
test("TerraCore cycle is observe-only unless one explicit action is requested", ()=>{
    assert.deepEqual(parseOptions([
        "--account",
        "michael561"
    ]), {
        account: "michael561",
        keyFile: "",
        executeOne: false,
        recoverTx: ""
    });
    assert.deepEqual(parseOptions([
        "--account",
        "michael561",
        "--key-file",
        "/private/posting.wif",
        "--execute-one"
    ]), {
        account: "michael561",
        keyFile: "/private/posting.wif",
        executeOne: true,
        recoverTx: ""
    });
    assert.deepEqual(parseOptions([
        "--account",
        "michael561",
        "--recover-tx",
        "a".repeat(40)
    ]), {
        account: "michael561",
        keyFile: "",
        executeOne: false,
        recoverTx: "a".repeat(40)
    });
    assert.throws(()=>parseOptions([
            "--account",
            "michael561",
            "--execute-one"
        ]), /requires --key-file/);
    assert.throws(()=>parseOptions([
            "--account",
            "michael561",
            "--recover-tx",
            "a".repeat(40),
            "--key-file",
            "/private/posting.wif"
        ]), /cannot be combined/);
    assert.throws(()=>parseOptions([
            "--account",
            "michael561",
            "--battle",
            "victim"
        ]), /unknown argument/);
});
test("TerraCore battle reconciliation binds a new actor-target log", ()=>{
    const rows = [
        {
            _id: "old",
            username: "michael561",
            attacked: "target-one",
            scrap: 9,
            timestamp: 1000
        },
        {
            _id: "incoming",
            username: "other",
            attacked: "michael561",
            scrap: 4,
            timestamp: 3000
        },
        {
            _id: "new",
            username: "michael561",
            attacked: "target-one",
            scrap: 12.345678901,
            timestamp: 4000,
            dodged: false,
            roll: 42.5
        }
    ];
    assert.deepEqual(findNewBattleLog(rows, [
        "old"
    ], "michael561", "target-one", 3500), {
        id: "new",
        actor: "michael561",
        target: "target-one",
        timestamp: 4000,
        apiReportedScrap: "12.34567890",
        dodged: false,
        reason: null,
        roll: 42.5
    });
    assert.equal(findNewBattleLog(rows, [
        "old",
        "new"
    ], "michael561", "target-one", 3500), null);
});
test("TerraCore claim settlement requires both exact liquid gain and stash decrease", ()=>{
    assert.deepEqual(reconcileClaimBalances("289.44439576", "301.44439576", "12.00000000", "12.50000000", "0.50000000"), {
        confirmed: true,
        received: "12.00000000"
    });
    assert.equal(reconcileClaimBalances("289.44439576", "300.44439576", "12.00000000", "12.50000000", "0.50000000").confirmed, false);
    assert.equal(reconcileClaimBalances("289.44439576", "301.44439576", "12.00000000", "12.50000000", "12.60000000").confirmed, false);
    assert.deepEqual(reconcileClaimBalances("113.48115280", "135.04535132", "21.55644444", "21.556444444444445", "0.0910711111111111"), {
        confirmed: true,
        received: "21.56419852"
    });
    assert.equal(balancesAgree({
        balance: "1.00000000"
    }, {
        balance: "1.00000000"
    }), true);
});
test("a confirmed transaction whose game effect times out preserves its identity and forbids retry", ()=>{
    const receipt = settlementPendingReceipt({
        kind: "aagaard.terracore-one-action-receipt",
        account: "michael561"
    }, "cfa0b1d9f0af48f3c6c276fb538307578dca3487", [
        {
            node: "https://api.hive.blog",
            block: 108344553
        }
    ], new Error("delayed cross-system propagation"), "2026-07-22T02:48:00.000Z");
    assert.deepEqual(receipt, {
        kind: "aagaard.terracore-one-action-receipt",
        account: "michael561",
        status: "settlement-pending",
        transactionId: "cfa0b1d9f0af48f3c6c276fb538307578dca3487",
        hive: [
            {
                node: "https://api.hive.blog",
                block: 108344553
            }
        ],
        settlement: {
            confirmed: false,
            retryAllowed: false,
            reason: "the Hive transaction is confirmed but the game effect was not independently reconciled before timeout: delayed cross-system propagation"
        },
        completedAt: "2026-07-22T02:48:00.000Z"
    });
});

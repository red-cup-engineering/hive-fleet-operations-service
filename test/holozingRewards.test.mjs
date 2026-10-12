import assert from "node:assert/strict";
import test from "node:test";
import { parseHoloZingPendingRewards, planHoloZingRewardClaim, reconcileHoloZingRewardClaim } from "@red-cup-engineering/holozing-services-section";
import { attachHolozingDurableRecord, balancesAgree, keychainLoginEnvelope, loginMessage, parseOptions } from "../scripts/holozing-rewards.mjs";
const PENDING = parseHoloZingPendingRewards("michael561", "2026-07-22T01:57:50.000Z", {
    delegation: "0.000",
    stakeZing: "16.400",
    holdingRewards: "34982.709"
}, [
    1831
]);
test("HoloZing claim planning preserves the Alpha Vial and totals exact pending rewards", ()=>{
    assert.equal(PENDING.total, "34999.109");
    assert.deepEqual(PENDING.alphaVialIds, [
        1831
    ]);
    assert.deepEqual(planHoloZingRewardClaim(PENDING), {
        kind: "ready",
        reason: "claim converts server-pending rewards into on-chain staked ZING without opening or transferring an Alpha Vial",
        minimumClaimZing: "34999.109"
    });
    assert.equal(planHoloZingRewardClaim({
        ...PENDING,
        total: "0.999"
    }).kind, "refuse");
});
test("HoloZing pending parsing rejects precision drift and duplicate vial evidence", ()=>{
    assert.throws(()=>parseHoloZingPendingRewards("michael561", PENDING.observedAt, {
            delegation: "0.000",
            stakeZing: "16.4000",
            holdingRewards: "34982.709"
        }, [
            1831
        ]), /exceeds precision/);
    assert.throws(()=>parseHoloZingPendingRewards("michael561", PENDING.observedAt, {
            delegation: "0.000",
            stakeZing: "16.400",
            holdingRewards: "34982.709"
        }, [
            1831,
            1831
        ]), /must be unique/);
});
test("HoloZing Keychain login carrier exactly matches the production request shape", ()=>{
    const message = loginMessage("michael561", 1784686800);
    assert.equal(message, '{"username":"michael561","type":"login","app":"holozing","expiry":1784686800}');
    const signature = "a".repeat(130);
    const publicKey = `STM${"1".repeat(50)}`;
    const envelope = keychainLoginEnvelope("michael561", message, signature, publicKey);
    assert.equal(envelope.result, signature);
    assert.equal(envelope.publicKey, publicKey);
    assert.deepEqual(envelope.data, {
        type: "signBuffer",
        username: "michael561",
        message,
        method: "Posting",
        rpc: null,
        title: "Login to HoloZing",
        domain: "holozing.com"
    });
});
test("HoloZing settlement requires matching exact stake events, balance delta, and pending decrease", ()=>{
    const afterPending = parseHoloZingPendingRewards("michael561", "2026-07-22T02:05:00.000Z", {
        delegation: "0.000",
        stakeZing: "0.001",
        holdingRewards: "0.002"
    }, [
        1831
    ]);
    const events = [
        {
            transactionId: `${"a".repeat(40)}-0`,
            blockNumber: 61299999,
            quantity: "16.400",
            memo: "Your claim for staking ZING"
        },
        {
            transactionId: `${"a".repeat(40)}-1`,
            blockNumber: 61299999,
            quantity: "34982.709",
            memo: "Your claim for holding ZING achievements"
        }
    ];
    assert.deepEqual(reconcileHoloZingRewardClaim(PENDING, afterPending, {
        liquid: "11097.306",
        staked: "410.323"
    }, {
        liquid: "11097.306",
        staked: "35409.432"
    }, events), {
        confirmed: true,
        claimedZing: "34999.109"
    });
    const liquidChanged = reconcileHoloZingRewardClaim(PENDING, afterPending, {
        liquid: "11097.306",
        staked: "410.323"
    }, {
        liquid: "11097.307",
        staked: "35409.432"
    }, events);
    assert.equal(liquidChanged.confirmed, false);
    if (!liquidChanged.confirmed) assert.match(liquidChanged.reason, /liquid ZING changed/);
});
test("HoloZing runner is observe-only and admits only one explicit claim mode", ()=>{
    assert.deepEqual(parseOptions([
        "--account",
        "michael561"
    ]), {
        account: "michael561",
        keyFile: "",
        executeOne: false
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
            "--open-vial"
        ]), /unknown argument/);
    assert.equal(balancesAgree({
        liquid: "1.000",
        staked: "2.000"
    }, {
        liquid: "1.000",
        staked: "2.000"
    }), true);
    assert.equal(balancesAgree({
        liquid: "1.000",
        staked: "2.000"
    }, {
        liquid: "1.000",
        staked: "2.001"
    }), false);
});
test("post-submission witness failure remains an explicit do-not-retry receipt", async ()=>{
    const receipt = Object.freeze({
        status: "claim-submitted-unreconciled-do-not-retry",
        retryAllowed: false,
        completedAt: "2026-07-22T12:35:00.000Z"
    });
    const result = await attachHolozingDurableRecord(receipt, async ()=>{
        throw new Error("provider unavailable");
    });
    assert.equal(result.retryAllowed, false);
    assert.deepEqual(result.durableRecord, {
        confirmed: false,
        error: "provider unavailable"
    });
});

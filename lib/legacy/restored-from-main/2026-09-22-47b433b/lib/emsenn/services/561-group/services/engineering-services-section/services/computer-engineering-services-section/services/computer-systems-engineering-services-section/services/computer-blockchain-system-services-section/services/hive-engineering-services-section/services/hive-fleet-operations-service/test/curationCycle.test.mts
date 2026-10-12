import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

import {
  exactVoteOperation,
  majorityAgreement,
  majorityAvailableAgreement,
  parseOptions,
  postEvidenceFromRaw,
  postEvidenceIdentity,
  recordPendingReceipt,
  settlementPendingReceipt,
  voteVisible,
} from "../scripts/curation-cycle.mjs";
import { validateRemoteCurationRequest } from "../scripts/cold-red-gate-curation-broadcast.mjs";

const BROADCASTER = new URL("../scripts/hive-broadcast.mjs", import.meta.url);

function runBroadcaster(request: object): Promise<Readonly<{ code: number | null; stderr: string }>> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [BROADCASTER.pathname], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise(Object.freeze({ code, stderr })));
    child.stdin.end(JSON.stringify(request));
  });
}

test("curation operator is observe-only unless one explicit vote is requested", () => {
  assert.deepEqual(parseOptions(["--account", "emsenn0"]), { account: "emsenn0", keyFile: "", executeOne: false, coldRedGateSigner: false });
  assert.deepEqual(parseOptions(["--account", "emsenn0", "--key-file", "/private/posting.wif", "--execute-one"]), {
    account: "emsenn0", keyFile: "/private/posting.wif", executeOne: true, coldRedGateSigner: false,
  });
  assert.deepEqual(parseOptions(["--account", "emsenn0", "--cold-red-gate-signer", "--execute-one"]), {
    account: "emsenn0", keyFile: "", executeOne: true, coldRedGateSigner: true,
  });
  assert.throws(() => parseOptions(["--account", "emsenn0", "--execute-one"]), /requires --key-file or --cold-red-gate-signer/);
  assert.throws(() => parseOptions(["--account", "michael561", "--cold-red-gate-signer"]), /only for emsenn0/);
  assert.throws(() => parseOptions(["--account", "emsenn0", "--key-file", "x", "--cold-red-gate-signer"]), /mutually exclusive/);
  assert.throws(() => parseOptions(["--account", "emsenn0", "--weight", "10000"]), /unknown argument/);
});

test("cold-red-gate curation bridge mechanically enforces the reusable one-vote safety law", () => {
  const fields = { voter: "emsenn0", author: "ecency.stats", permlink: "ecency-daily-2026-07-22", weight: 5000 };
  const request = { account: "emsenn0", role: "posting", lane: "voting",
    target: "ecency.stats/ecency-daily-2026-07-22", keyFile: "cold-red-gate:emsenn0/posting",
    operation: ["vote", fields] };
  assert.equal(validateRemoteCurationRequest(request), true);
  assert.equal(validateRemoteCurationRequest({ ...request, target: "other/post",
    operation: ["vote", { ...fields, author: "other", permlink: "post", weight: 100 }] }), true);
  assert.throws(() => validateRemoteCurationRequest({ ...request, target: "other/post" }), /unsafe operation/);
  assert.throws(() => validateRemoteCurationRequest({ ...request,
    operation: ["vote", { ...fields, weight: 5001 }] }), /unsafe operation/);
  assert.throws(() => validateRemoteCurationRequest({ ...request,
    operation: ["vote", { ...fields, weight: -100 }] }), /unsafe operation/);
  assert.throws(() => validateRemoteCurationRequest({ ...request,
    operation: ["vote", { ...fields, voter: "attacker" }] }), /unsafe operation/);
  assert.throws(() => validateRemoteCurationRequest({ ...request, keyFile: "local" }), /unsafe operation/);
});

test("broadcaster admits only one exact positive bounded curation vote", async () => {
  const voteFields = { voter: "emsenn0", author: "writer", permlink: "a-good-post", weight: 5000 };
  const request = {
    account: "emsenn0",
    role: "posting",
    lane: "voting",
    target: "writer/a-good-post",
    keyFile: "/definitely-missing-curation-key.wif",
    operation: ["vote", voteFields],
  };
  const admitted = await runBroadcaster(request);
  assert.equal(admitted.code, 1);
  assert.match(admitted.stderr, /cannot read key file/);
  const downvote = await runBroadcaster({ ...request, operation: ["vote", { ...voteFields, weight: -100 }] });
  assert.match(downvote.stderr, /exact positive one-vote lane/);
  const overCap = await runBroadcaster({ ...request, operation: ["vote", { ...voteFields, weight: 5001 }] });
  assert.match(overCap.stderr, /exact positive one-vote lane/);
  const wrongTarget = await runBroadcaster({ ...request, target: "other/a-good-post" });
  assert.match(wrongTarget.stderr, /exact positive one-vote lane/);
  const wrongVoter = await runBroadcaster({ ...request, operation: ["vote", { ...voteFields, voter: "other" }] });
  assert.match(wrongVoter.stderr, /exact positive one-vote lane/);
});

test("curation evidence requires majority agreement, positive payout, time, and no prior vote", () => {
  assert.deepEqual(majorityAgreement([
    { node: "a", value: { x: 1 } }, { node: "b", value: { x: 1 } }, { node: "c", value: { x: 2 } },
  ]), { value: { x: 1 }, providers: ["a", "b"] });
  const raw = {
    author: "writer",
    permlink: "a-good-post",
    title: "Good post",
    body: "Substantial original body",
    category: "hive",
    json_metadata: JSON.stringify({ tags: ["hive"] }),
    pending_payout_value: "1.000 HBD",
    max_accepted_payout: "1000.000 HBD",
    net_rshares: "10000",
    children: 3,
    created: "2026-07-22T00:00:00",
    payout_at: "2026-07-29T00:00:00",
    is_paidout: false,
    active_votes: [],
  };
  const evidence = postEvidenceFromRaw(raw, "emsenn0", Date.parse("2026-07-22T01:00:00Z"));
  assert.equal(evidence.author, "writer");
  assert.equal(postEvidenceIdentity(evidence), postEvidenceIdentity({
    ...evidence,
    candidate: { ...(evidence.candidate as Readonly<Record<string, unknown>>), ageHours: 12.0001 },
  }));
  assert.notEqual(postEvidenceIdentity(evidence), postEvidenceIdentity({
    ...evidence,
    votes: [{ voter: "someone", rshares: "1", percent: 0, time: "" }],
  }));
  assert.throws(() => postEvidenceFromRaw({ ...raw, active_votes: [{ voter: "emsenn0", percent: 5000 }] }, "emsenn0", Date.parse("2026-07-22T01:00:00Z")), /already voted/);
  assert.throws(() => postEvidenceFromRaw({ ...raw, pending_payout_value: "0.000 HBD" }, "emsenn0", Date.parse("2026-07-22T01:00:00Z")), /positive pending/);
  assert.equal(voteVisible({ active_votes: [{ voter: "emsenn0", rshares: "123" }] }, "emsenn0"), true);
  assert.equal(voteVisible({ active_votes: [{ voter: "emsenn0", rshares: "-123" }] }, "emsenn0"), false);
  assert.equal(voteVisible({ active_votes: [{ voter: "emsenn0", percent: 5000 }] }, "emsenn0"), false);
});

test("one unavailable Hive provider cannot erase two exact curation witnesses", () => {
  assert.deepEqual(majorityAvailableAgreement([
    { node: "a", status: "available", value: { x: 1 } },
    { node: "b", status: "unavailable", problem: "timeout" },
    { node: "c", status: "available", value: { x: 1 } },
  ], "post evidence"), { value: { x: 1 }, providers: ["a", "c"] });
  assert.throws(() => majorityAvailableAgreement([
    { node: "a", status: "available", value: { x: 1 } },
    { node: "b", status: "unavailable", problem: "timeout" },
  ], "post evidence"), /fewer than two/u);
});

test("post-broadcast visibility timeout preserves the transaction and forbids retry", () => {
  const receipt = settlementPendingReceipt({ kind: "receipt" }, "a".repeat(40), [{ node: "a", block: 1 }], new Error("visibility delayed"), "2026-07-22T03:00:00.000Z");
  assert.equal(receipt.status, "settlement-pending");
  assert.equal(receipt.transactionId, "a".repeat(40));
  assert.deepEqual(receipt.immediateEffect, { confirmed: false, retryAllowed: false, reason: "visibility delayed" });
});

test("transaction confirmation ignores field order but admits no field drift", () => {
  const expected = { voter: "emsenn0", author: "writer", permlink: "good-post", weight: 5000 };
  assert.equal(exactVoteOperation({ author: "writer", permlink: "good-post", voter: "emsenn0", weight: 5000 }, expected), true);
  assert.equal(exactVoteOperation({ ...expected, weight: 4999 }, expected), false);
  assert.equal(exactVoteOperation({ ...expected, extra: true }, expected), false);
});

test("a durable-record failure preserves the confirmed vote and forbids retry", () => {
  const identity = { account: "emsenn0", transactionId: "b".repeat(40) };
  const receipt = recordPendingReceipt({ kind: "receipt" }, "b".repeat(40), [{ node: "a", block: 1 }], identity, new Error("provider unavailable"), "2026-07-22T03:20:00.000Z");
  assert.equal(receipt.status, "record-pending");
  assert.deepEqual(receipt.immediateEffect, { confirmed: true, retryAllowed: false });
  assert.deepEqual(receipt.settlementIdentity, identity);
  assert.deepEqual(receipt.durableRecord, { confirmed: false, error: "provider unavailable" });
});

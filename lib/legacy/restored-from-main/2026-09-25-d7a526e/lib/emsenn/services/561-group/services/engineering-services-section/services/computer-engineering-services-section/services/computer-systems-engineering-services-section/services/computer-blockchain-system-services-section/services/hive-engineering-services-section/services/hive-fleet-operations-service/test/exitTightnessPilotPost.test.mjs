import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { EXIT_TIGHTNESS_PILOT_BODY_SHA256, EXIT_TIGHTNESS_PILOT_TARGET, assertExactExitTightnessPilotPost, exitTightnessPilotComment, exitTightnessPilotOffer } from "../src/core/exitTightnessPilotPost.mjs";
import { productPilotPublicationEvent } from "../src/core/productPilotSettlement.mjs";
import { validateRemoteRequest } from "../scripts/cold-red-gate-product-pilot-broadcast.mjs";
import { agreeOnRequests, parsePilotRequest } from "../scripts/monitor-exit-tightness-pilot.mjs";
import { parseOptions } from "../scripts/publish-exit-tightness-pilot.mjs";
const BROADCASTER = fileURLToPath(new URL("../scripts/hive-broadcast.mjs", import.meta.url));
function request(fields) {
    return {
        account: "emsenn0",
        role: "posting",
        lane: "product-pilot",
        target: EXIT_TIGHTNESS_PILOT_TARGET,
        keyFile: "/nonexistent/posting.wif",
        operation: [
            "comment",
            fields
        ]
    };
}
function run(fields) {
    return spawnSync(process.execPath, [
        BROADCASTER
    ], {
        input: JSON.stringify(request(fields)),
        encoding: "utf8"
    });
}
test("the historical mispublication remains digest-bound evidence", ()=>{
    const fields = exitTightnessPilotComment();
    assert.equal(fields.author, "emsenn0");
    assert.equal(fields.parent_permlink, "hive-engine");
    assert.match(fields.body, /do \*\*not\*\* send payment/u);
    assert.equal(assertExactExitTightnessPilotPost({
        account: "emsenn0",
        role: "posting",
        lane: "product-pilot",
        target: EXIT_TIGHTNESS_PILOT_TARGET,
        fields
    }), true);
    assert.deepEqual(exitTightnessPilotOffer().terms, {
        price: "0.250 HBD",
        maximumPaidReports: 5,
        paymentAsset: "HBD",
        invoiceBeforePayment: true,
        revenueBeforeSettledPayment: "0.000 HBD"
    });
    assert.match(EXIT_TIGHTNESS_PILOT_BODY_SHA256, /^[0-9a-f]{64}$/u);
});
test("emsenn0 vote-only law refuses the historical article before reading a key", ()=>{
    const exact = exitTightnessPilotComment();
    const refusedExact = run(exact);
    assert.notEqual(refusedExact.status, 0);
    assert.match(refusedExact.stderr, /emsenn0 is vote-only/u);
    assert.doesNotMatch(refusedExact.stderr, /cannot read key file/u);
    for (const changed of [
        {
            ...exact,
            body: `${exact.body}\nchanged`
        },
        {
            ...exact,
            permlink: "another-post"
        },
        {
            ...exact,
            json_metadata: "{}"
        },
        {
            ...exact,
            extra: true
        }
    ]){
        const refused = run(changed);
        assert.notEqual(refused.status, 0);
        assert.match(refused.stderr, /emsenn0 is vote-only/u);
        assert.doesNotMatch(refused.stderr, /cannot read key file/u);
    }
});
test("publication receipts preserve zero revenue and two-provider settlement evidence", ()=>{
    const event = productPilotPublicationEvent({
        transactionId: "a".repeat(40),
        block: 108_400_000,
        hiveProviders: [
            "https://api.openhive.network",
            "https://api.hive.blog",
            "https://api.hive.blog"
        ],
        recordedAt: "2026-07-22T08:00:00.000Z"
    });
    assert.equal(event.terms.revenueRecognized, "0.000 HBD");
    assert.deepEqual(event.hiveProviders, [
        "https://api.hive.blog",
        "https://api.openhive.network"
    ]);
    assert.match(event.publicationId, /^urn:aagaard:product-pilot-publication:/u);
    assert.throws(()=>productPilotPublicationEvent({
            transactionId: "bad",
            block: 1,
            hiveProviders: [
                "https://a",
                "https://b"
            ]
        }), /transaction id/u);
});
test("publisher remains observe-only unless one explicit execution is requested", ()=>{
    assert.deepEqual(parseOptions([]), {
        observeOnly: true
    });
    for (const args of [
        [
            "--execute-one"
        ],
        [
            "--key-file",
            "/tmp/key"
        ],
        [
            "--cold-red-gate-signer"
        ],
        [
            "--settle-tx",
            "A".repeat(40)
        ]
    ]){
        assert.throws(()=>parseOptions(args), /signer retired/u);
    }
});
test("the cold-red-gate product bridge is retired without key access", ()=>{
    const exact = request(exitTightnessPilotComment());
    exact.keyFile = "cold-red-gate:emsenn0/posting";
    assert.throws(()=>validateRemoteRequest(exact), /emsenn0 is vote-only/u);
    assert.throws(()=>validateRemoteRequest({
            ...exact,
            account: "michael561"
        }), /signer retired/u);
});
test("demand monitoring admits exact interest syntax without calling it payment", ()=>{
    assert.deepEqual(parsePilotRequest("pilot account=Some.User symbol=spi"), {
        account: "some.user",
        symbol: "SPI",
        quantity: null
    });
    assert.deepEqual(parsePilotRequest("pilot account=buyer symbol=DEC quantity=12.500"), {
        account: "buyer",
        symbol: "DEC",
        quantity: "12.500"
    });
    for (const refused of [
        "buy SPI",
        "pilot account=x symbol=SPI",
        "pilot account=buyer symbol=$PI",
        "pilot account=buyer symbol=SPI quantity=0"
    ]){
        assert.equal(parsePilotRequest(refused), null);
    }
    const requests = Object.freeze([
        {
            replyAuthor: "buyer",
            request: {
                account: "buyer",
                symbol: "SPI",
                quantity: null
            },
            commercialState: "interest-not-invoice-or-payment"
        }
    ]);
    const agreement = agreeOnRequests([
        {
            node: "a",
            available: true,
            requests
        },
        {
            node: "b",
            available: true,
            requests
        },
        {
            node: "c",
            available: false,
            requests: []
        }
    ]);
    assert.equal(agreement.knowledge, "true");
    assert.deepEqual(agreement.requests, requests);
});

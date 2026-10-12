import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { assertAccountMutationRole } from "../src/core/accountMutationRoles.mjs";
import { EXIT_VALUE_EDITORIAL, EXIT_VALUE_MERCHANT, assertExactExitValueServicePost, exitValueMerchantOffer, exitValueServiceComment } from "../src/core/exitValueServicePosts.mjs";
import { exitValuePublicationEvent } from "../src/core/exitValueServicePublicationSettlement.mjs";
import { accountRoleRectificationEvent } from "../src/core/accountRoleRectificationSettlement.mjs";
import { parseMerchantHbdTransfer } from "../scripts/monitor-exit-value-service.mjs";
import { exactServicePublicationOperation, parseOptions } from "../scripts/publish-exit-value-service.mjs";
const BROADCASTER = new URL("../scripts/hive-broadcast.mjs", import.meta.url).pathname;
function request(kind, fields = exitValueServiceComment(kind)) {
    const spec = kind === "merchant" ? EXIT_VALUE_MERCHANT : EXIT_VALUE_EDITORIAL;
    return {
        account: spec.account,
        role: "posting",
        lane: spec.lane,
        target: spec.target,
        keyFile: "/missing/posting.wif",
        operation: [
            "comment",
            fields
        ]
    };
}
test("account-role law makes emsenn0 vote-only", ()=>{
    assert.equal(assertAccountMutationRole({
        account: "emsenn0",
        role: "posting",
        lane: "voting",
        operation: "vote"
    }), true);
    for (const changed of [
        {
            account: "emsenn0",
            role: "posting",
            lane: "product-pilot",
            operation: "comment"
        },
        {
            account: "emsenn0",
            role: "active",
            lane: "trading",
            operation: "custom_json"
        },
        {
            account: "emsenn0",
            role: "posting",
            lane: "gaming",
            operation: "custom_json"
        }
    ])assert.throws(()=>assertAccountMutationRole(changed), /vote-only/u);
    assert.equal(assertAccountMutationRole({
        account: "sigmund-vexler",
        role: "posting",
        lane: "editorial-publication",
        operation: "comment"
    }), true);
});
test("merchant and editorial posts bind the assigned accounts and commercial routing", ()=>{
    const merchant = exitValueServiceComment("merchant");
    const editorial = exitValueServiceComment("editorial");
    assert.equal(merchant.author, "help-fund");
    assert.match(String(merchant.body), /payable to `help-fund`/u);
    assert.match(String(merchant.body), /Do \*\*not\*\* send payment/u);
    assert.equal(editorial.author, "sigmund-vexler");
    assert.match(String(editorial.body), /hive\.blog\/@help-fund\/hive-engine-exit-value-report-pilot/u);
    assert.match(String(editorial.body), /do not request or pay under this editorial article/iu);
    assert.equal(assertExactExitValueServicePost({
        account: "help-fund",
        role: "posting",
        lane: "merchant-offer-publication",
        target: EXIT_VALUE_MERCHANT.target,
        fields: merchant
    }), "merchant");
    assert.equal(exitValueMerchantOffer().terms.paymentAccount, "help-fund");
});
test("signer admits only the two exact assigned posts before key access", ()=>{
    for (const kind of [
        "merchant",
        "editorial"
    ]){
        const fields = exitValueServiceComment(kind);
        const exact = request(kind, fields);
        const admitted = spawnSync(process.execPath, [
            BROADCASTER
        ], {
            input: JSON.stringify(exact),
            encoding: "utf8"
        });
        assert.notEqual(admitted.status, 0);
        assert.match(admitted.stderr, /cannot read key file/u);
        for (const changed of [
            {
                ...exact,
                account: "emsenn0"
            },
            {
                ...exact,
                role: "active"
            },
            request(kind, {
                ...fields,
                body: `${String(fields.body)}\nchanged`
            })
        ]){
            const refused = spawnSync(process.execPath, [
                BROADCASTER
            ], {
                input: JSON.stringify(changed),
                encoding: "utf8"
            });
            assert.notEqual(refused.status, 0);
            assert.doesNotMatch(refused.stderr, /cannot read key file/u);
        }
        assert.equal(exactServicePublicationOperation(kind, exact.operation), true);
    }
});
test("publication operator and durable events retain the exact split", ()=>{
    assert.deepEqual(parseOptions([
        "--kind",
        "merchant"
    ]), {
        kind: "merchant",
        keyFile: "",
        executeOne: false,
        settleTx: ""
    });
    assert.deepEqual(parseOptions([
        "--kind",
        "editorial",
        "--key-file",
        "/tmp/key",
        "--execute-one"
    ]), {
        kind: "editorial",
        keyFile: "/tmp/key",
        executeOne: true,
        settleTx: ""
    });
    assert.throws(()=>parseOptions([
            "--kind",
            "other"
        ]), /merchant or editorial/u);
    const merchant = exitValuePublicationEvent({
        kind: "merchant",
        transactionId: "a".repeat(40),
        block: 108400001,
        hiveProviders: [
            "https://one.example",
            "https://two.example"
        ],
        recordedAt: "2026-07-22T16:00:00Z"
    });
    assert.equal(merchant.account, "help-fund");
    assert.equal(merchant.terms?.paymentAccount, "help-fund");
    const editorial = exitValuePublicationEvent({
        kind: "editorial",
        transactionId: "b".repeat(40),
        block: 108400002,
        hiveProviders: [
            "https://one.example",
            "https://two.example"
        ]
    });
    assert.equal(editorial.account, "sigmund-vexler");
    assert.equal(editorial.terms, null);
});
test("merchant monitoring and durable rectification route commerce only to help-fund", ()=>{
    const transfer = [
        9,
        {
            block: 108400010,
            trx_id: "c".repeat(40),
            op: [
                "transfer",
                {
                    from: "buyer",
                    to: "help-fund",
                    amount: "0.250 HBD",
                    memo: "invoice later"
                }
            ]
        }
    ];
    assert.equal(parseMerchantHbdTransfer(transfer, 108400000)?.to, "help-fund");
    assert.equal(parseMerchantHbdTransfer([
        9,
        {
            ...transfer[1],
            op: [
                "transfer",
                {
                    from: "buyer",
                    to: "emsenn0",
                    amount: "0.250 HBD",
                    memo: "wrong"
                }
            ]
        }
    ], 108400000), null);
    const merchant = exitValuePublicationEvent({
        kind: "merchant",
        transactionId: "a".repeat(40),
        block: 108400001,
        hiveProviders: [
            "https://one.example",
            "https://two.example"
        ]
    });
    const editorial = exitValuePublicationEvent({
        kind: "editorial",
        transactionId: "b".repeat(40),
        block: 108400002,
        hiveProviders: [
            "https://one.example",
            "https://two.example"
        ]
    });
    const empty = `sha256:${"0".repeat(64)}`;
    const monitor = {
        kind: "aagaard.exit-value-service-monitor",
        merchant: "help-fund",
        publicationId: merchant.publicationId,
        requestKnowledge: {
            knowledge: "true",
            requests: [],
            stateDigest: empty
        },
        transferKnowledge: {
            knowledge: "true",
            transfers: [],
            stateDigest: empty
        },
        commercialLedger: {
            interestRequests: 0,
            incomingHbdTransfers: 0,
            invoicesIssued: 0,
            settledPayments: 0,
            reportsDelivered: 0,
            revenue: "0.000 HBD"
        }
    };
    const event = accountRoleRectificationEvent({
        merchant,
        editorial,
        monitor,
        procurementResidue: "an A2A SEN operation must carry exactly one application/sen+cbor raw part"
    });
    assert.deepEqual(event.roles, {
        emsenn0: "curation-vote-only",
        "sigmund-vexler": "editorial-publisher",
        "help-fund": "service-merchant-request-invoice-payment-and-delivery-counterparty"
    });
    assert.equal(event.historicalMispublication.productSignerRetired, true);
});

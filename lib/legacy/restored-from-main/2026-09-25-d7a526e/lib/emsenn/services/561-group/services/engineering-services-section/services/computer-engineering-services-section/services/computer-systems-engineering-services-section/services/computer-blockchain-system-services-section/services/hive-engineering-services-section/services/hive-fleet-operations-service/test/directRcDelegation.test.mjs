import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { planProductRcDelegation, PRODUCT_RC_DELEGATION, PRODUCT_RC_TARGET, productRcDelegationOperation } from "../src/core/directRcDelegation.mjs";
import { directRcDelegationEvent } from "../src/core/directRcDelegationSettlement.mjs";
import { exactDirectRcOperation, parseOptions } from "../scripts/product-rc-delegation.mjs";
const BROADCASTER = new URL("../scripts/hive-broadcast.mjs", import.meta.url).pathname;
const OBSERVED = "2026-07-22T15:14:33.000Z";
function state(account, maximumRc, currentMana) {
    return {
        account,
        maximumRc,
        currentMana,
        updatedAt: Math.floor(Date.parse(OBSERVED) / 1000),
        delegatedRc: "0",
        receivedDelegatedRc: "0"
    };
}
function readyPlan() {
    return planProductRcDelegation({
        observedAt: OBSERVED,
        averageCustomJsonRc: "169569772",
        minimumDelegationRc: [
            "1617526025",
            "1617526020"
        ],
        donor: state("help-fund", "16152678866", "11878580824"),
        recipient: state("michael561", "5089858976", "44731705"),
        existingOutgoing: []
    });
}
test("direct-RC planner proves the protocol minimum and both reserve gates", ()=>{
    const plan = readyPlan();
    assert.equal(plan.decision, "delegate-one-exact-rc-allocation");
    assert.equal(plan.amountRc, PRODUCT_RC_DELEGATION.toString());
    assert.equal(plan.maximumObservedMinimumRc, "1617526025");
    assert.equal(plan.donorReserveAfterAllocationRc, "10260580824");
    assert.equal(plan.recipientAfterAllocationRc, "1662731705");
    assert.equal(plan.requiredRc, "339139544");
    assert.equal(plan.formulae.protocolGate, "N>=max(minimum_RC_each_provider)");
    assert.equal(planProductRcDelegation({
        observedAt: OBSERVED,
        averageCustomJsonRc: "169569772",
        minimumDelegationRc: [
            "1617526025",
            "1617526020"
        ],
        donor: state("help-fund", "16152678866", "11878580824"),
        recipient: state("michael561", "5089858976", "44731705"),
        existingOutgoing: [
            {
                from: "help-fund",
                to: "other",
                delegated_rc: "1"
            }
        ]
    }).decision, "refuse-existing-outgoing-delegation");
    assert.equal(planProductRcDelegation({
        observedAt: OBSERVED,
        averageCustomJsonRc: "169569772",
        minimumDelegationRc: [
            "1619000000",
            "1619000000"
        ],
        donor: state("help-fund", "16152678866", "11878580824"),
        recipient: state("michael561", "5089858976", "44731705"),
        existingOutgoing: []
    }).decision, "refuse-below-protocol-minimum");
});
test("signer admits only the exact product RC allocation before key access", ()=>{
    const operation = productRcDelegationOperation();
    const request = {
        account: "help-fund",
        role: "posting",
        lane: "product-rc-delegation",
        target: PRODUCT_RC_TARGET,
        keyFile: "/missing/posting.wif",
        operation
    };
    const admitted = spawnSync(process.execPath, [
        BROADCASTER
    ], {
        input: JSON.stringify(request),
        encoding: "utf8"
    });
    assert.notEqual(admitted.status, 0);
    assert.match(admitted.stderr, /cannot read key file/u);
    const fields = operation[1];
    const decoded = JSON.parse(fields.json);
    for (const changed of [
        {
            ...request,
            account: "michael561"
        },
        {
            ...request,
            role: "active"
        },
        {
            ...request,
            target: "other"
        },
        {
            ...request,
            operation: [
                "custom_json",
                {
                    ...fields,
                    json: JSON.stringify({
                        ...decoded,
                        value: {
                            ...decoded.value,
                            max_rc: Number(PRODUCT_RC_DELEGATION) + 1
                        }
                    })
                }
            ]
        },
        {
            ...request,
            operation: [
                "custom_json",
                {
                    ...fields,
                    required_posting_auths: [
                        "michael561"
                    ]
                }
            ]
        }
    ]){
        const refused = spawnSync(process.execPath, [
            BROADCASTER
        ], {
            input: JSON.stringify(changed),
            encoding: "utf8"
        });
        assert.notEqual(refused.status, 0);
        assert.match(refused.stderr, /product RC delegation/u);
        assert.doesNotMatch(refused.stderr, /cannot read key file/u);
    }
});
test("transaction matcher and operator surface admit no drift", ()=>{
    const operation = productRcDelegationOperation();
    assert.equal(exactDirectRcOperation(operation), true);
    assert.equal(exactDirectRcOperation([
        "custom_json_operation",
        operation[1]
    ]), true);
    assert.equal(exactDirectRcOperation([
        "custom_json",
        {
            ...operation[1],
            id: "follow"
        }
    ]), false);
    assert.deepEqual(parseOptions([
        "--account",
        "help-fund"
    ]), {
        account: "help-fund",
        keyFile: "",
        executeOne: false
    });
    assert.deepEqual(parseOptions([
        "--account",
        "help-fund",
        "--key-file",
        "/tmp/key",
        "--execute-one"
    ]), {
        account: "help-fund",
        keyFile: "/tmp/key",
        executeOne: true
    });
    assert.throws(()=>parseOptions([
            "--account",
            "michael561"
        ]), /exactly help-fund/u);
    assert.throws(()=>parseOptions([
            "--account",
            "help-fund",
            "--execute-one"
        ]), /requires --key-file/u);
});
test("durable event requires independent prestate, transaction, and delegation confirmation", ()=>{
    const plan = {
        ...readyPlan(),
        evidence: {
            knowledge: "true",
            stateDigest: `sha256:${"a".repeat(64)}`,
            providers: [
                "https://one.example",
                "https://two.example"
            ],
            minimumDelegationRc: []
        }
    };
    const pending = directRcDelegationEvent({
        kind: "aagaard.direct-rc-delegation-receipt",
        status: "settlement-pending",
        transactionId: "b".repeat(40),
        plan,
        credentialAccess: true,
        chainMutation: true
    });
    assert.equal(pending.block, null);
    assert.equal(pending.retryAllowed, false);
    const confirmed = directRcDelegationEvent({
        kind: "aagaard.direct-rc-delegation-receipt",
        status: "delegation-confirmed",
        transactionId: "b".repeat(40),
        plan,
        credentialAccess: true,
        chainMutation: true,
        hive: [
            {
                node: "https://one.example",
                block: 108400000
            },
            {
                node: "https://two.example",
                block: 108400000
            }
        ],
        delegationProviders: [
            "https://one.example",
            "https://two.example"
        ]
    });
    assert.equal(confirmed.block, 108400000);
    assert.throws(()=>directRcDelegationEvent({
            kind: "aagaard.direct-rc-delegation-receipt",
            status: "delegation-confirmed",
            transactionId: "b".repeat(40),
            plan,
            credentialAccess: true,
            chainMutation: true,
            hive: [
                {
                    node: "https://one.example",
                    block: 1
                }
            ],
            delegationProviders: [
                "https://one.example"
            ]
        }), /transaction confirmations/u);
});

import assert from "node:assert/strict";
import test from "node:test";
import { productPilotDistributionEvent } from "../src/core/productPilotSettlement.mjs";
import { productRevenueCycle42Event } from "../src/core/productRevenueCycle42Settlement.mjs";
const RESIDUE = "an A2A SEN operation must carry exactly one application/sen+cbor raw part";
const monitor = {
    kind: "aagaard.exit-tightness-product-pilot-monitor",
    credentialAccess: false,
    chainMutation: false,
    commercialLedger: {
        interestRequests: 0,
        incomingHbdTransfers: 0,
        invoicesIssued: 0,
        settledPayments: 0,
        reportsDelivered: 0,
        revenue: "0.000 HBD",
        pilotPrice: "0.250 HBD"
    },
    requestKnowledge: {
        knowledge: "true",
        requests: [],
        stateDigest: `sha256:${"a".repeat(64)}`
    },
    transferKnowledge: {
        knowledge: "true",
        transfers: [],
        stateDigest: `sha256:${"b".repeat(64)}`
    }
};
const delegation = {
    directRcDelegationSchema: "aagaard.direct-rc-delegation.v1",
    eventId: "urn:aagaard:direct-rc:test",
    status: "delegation-confirmed",
    transactionId: "c".repeat(40),
    block: 108359644,
    from: "help-fund",
    to: "michael561",
    amountRc: "1618000000",
    credentialAccess: true,
    chainMutation: true,
    retryAllowed: false,
    hiveProviders: [
        "https://one.example",
        "https://two.example"
    ],
    delegationProviders: [
        "https://one.example",
        "https://two.example"
    ]
};
const distribution = productPilotDistributionEvent({
    status: "distributed-confirmed",
    transactionId: "d".repeat(40),
    block: 108359655,
    hiveProviders: [
        "https://one.example",
        "https://two.example"
    ],
    followers: 21,
    observedAt: "2026-07-22T15:24:30Z",
    currentRc: "1801496140",
    requiredRc: "339139544"
});
test("cycle 42 binds RC allocation, distribution, and zero realized revenue", ()=>{
    const event = productRevenueCycle42Event({
        monitor,
        delegation,
        distribution,
        procurementResidue: RESIDUE,
        recordedAt: "2026-07-22T15:30:00Z"
    });
    assert.deepEqual(event.cycle, {
        globalStep: 42,
        angle: "product-revenue",
        nextAngle: "games-capability"
    });
    assert.equal(event.resourceAllocation.amountRc, "1618000000");
    assert.equal(event.resourceAllocation.liquidCapitalMoved, false);
    assert.equal(event.distribution.followers, 21);
    assert.equal(event.funnel.realizedRevenue, "0.000 HBD");
    assert.deepEqual(event.capitalMoved, {
        hive: "0.000 HIVE",
        hbd: "0.000 HBD",
        tokens: false
    });
    assert.throws(()=>productRevenueCycle42Event({
            monitor: {
                ...monitor,
                commercialLedger: {
                    ...monitor.commercialLedger,
                    revenue: "0.010 HBD"
                }
            },
            delegation,
            distribution,
            procurementResidue: RESIDUE
        }), /zero-revenue/u);
    assert.throws(()=>productRevenueCycle42Event({
            monitor,
            delegation: {
                ...delegation,
                amountRc: "1"
            },
            distribution,
            procurementResidue: RESIDUE
        }), /direct-RC/u);
});

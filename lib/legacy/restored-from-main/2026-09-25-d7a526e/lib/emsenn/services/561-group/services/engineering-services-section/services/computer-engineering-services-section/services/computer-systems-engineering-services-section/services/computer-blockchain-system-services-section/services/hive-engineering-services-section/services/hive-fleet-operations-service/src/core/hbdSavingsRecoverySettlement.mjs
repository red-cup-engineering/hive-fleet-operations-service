import { createHash } from "node:crypto";
import { assertPlainObject as record } from "./objectGuards.mjs";
export const HBD_SAVINGS_RECOVERY_SCHEMA = "aagaard.hbd-savings-recovery.v1";
export const HBD_SAVINGS_RECOVERY_CATEGORY = "aagaard.hbd-savings-recovery-event";
const EXIT_ID = "urn:aagaard:hbd-savings-exit:e-DK_l-iSSU2Bsfvsz6_nFbeUWt7ivM-QR6XbrBu_QU";
function rows(value, label) {
    if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
    return value;
}
function hbd(value, label) {
    const text = String(value ?? "");
    if (!/^(?:0|[1-9][0-9]*)\.[0-9]{3} HBD$/u.test(text)) throw new TypeError(`${label} is malformed`);
    return text;
}
export function hbdSavingsRecoveryEvent(receipt, recordedAt = new Date().toISOString()) {
    const knowledge = record(receipt.providerKnowledge, "recovery provider knowledge");
    const groups = rows(knowledge.stateDigests, "recovery state digests");
    if (receipt.kind !== "aagaard.hbd-savings-recovery-observation" || receipt.sourceExitEventId !== EXIT_ID || receipt.account !== "michael561" || receipt.requestId !== 108346161 || receipt.amount !== "16.298 HBD" || receipt.completeAt !== "2026-07-25T04:09:27.000Z" || ![
        "pending",
        "delivered"
    ].includes(String(receipt.status)) || receipt.credentialAccess !== false || receipt.chainMutation !== false || knowledge.value !== "true" || groups.length !== 1) {
        throw new TypeError("not the exact independently known HBD savings recovery observation");
    }
    const group = record(groups[0], "recovery digest group");
    const stateDigest = String(group.stateDigest ?? "");
    const providers = rows(group.providers, "recovery providers").map(String).sort();
    const state = record(receipt.state, "recovery state");
    if (!/^sha256:[0-9a-f]{64}$/u.test(stateDigest) || providers.length < 2 || new Set(providers).size !== providers.length || state.account !== "michael561") throw new TypeError("recovery exact state support is malformed");
    const status = String(receipt.status);
    const request = state.request === null ? null : record(state.request, "savings withdrawal request");
    const delivery = state.delivery === null ? null : record(state.delivery, "savings delivery source");
    if (status === "pending" && (request?.requestId !== 108346161 || request.amount !== "16.298 HBD" || request.from !== "michael561" || request.to !== "michael561" || request.memo !== "aagaard:hbd-savings-exit:v1" || request.completeAt !== "2026-07-25T04:09:27.000Z" || delivery !== null)) throw new TypeError("pending recovery lacks the exact live withdrawal");
    if (status === "delivered" && (request !== null || delivery?.requestId !== 108346161 || delivery.amount !== "16.298 HBD" || delivery.from !== "michael561" || delivery.to !== "michael561" || delivery.memo !== "aagaard:hbd-savings-exit:v1" || !Number.isSafeInteger(Number(delivery.historyIndex)) || !Number.isSafeInteger(Number(delivery.block)))) {
        throw new TypeError("delivered recovery lacks the exact fill_transfer_from_savings source");
    }
    const deliverySource = delivery === null ? null : Object.freeze({
        historyIndex: Number(delivery.historyIndex),
        block: Number(delivery.block),
        timestamp: new Date(String(delivery.timestamp)).toISOString()
    });
    const observedAt = new Date(String(receipt.observedAt)).toISOString();
    const eventId = `urn:aagaard:hbd-savings-recovery:${createHash("sha256").update(JSON.stringify([
        status,
        stateDigest
    ])).digest("base64url")}`;
    return Object.freeze({
        hbdSavingsRecoverySchema: HBD_SAVINGS_RECOVERY_SCHEMA,
        eventId,
        recordedAt: new Date(recordedAt).toISOString(),
        sourceExitEventId: EXIT_ID,
        account: "michael561",
        requestId: 108346161,
        amount: "16.298 HBD",
        completeAt: "2026-07-25T04:09:27.000Z",
        status,
        observedAt,
        stateDigest,
        providers: Object.freeze(providers),
        liquidHbd: hbd(state.liquidHbd, "liquid HBD"),
        savingsHbd: hbd(state.savingsHbd, "savings HBD"),
        deliverySource,
        credentialAccess: false,
        chainMutation: false,
        receipt: Object.freeze(JSON.parse(JSON.stringify(receipt)))
    });
}

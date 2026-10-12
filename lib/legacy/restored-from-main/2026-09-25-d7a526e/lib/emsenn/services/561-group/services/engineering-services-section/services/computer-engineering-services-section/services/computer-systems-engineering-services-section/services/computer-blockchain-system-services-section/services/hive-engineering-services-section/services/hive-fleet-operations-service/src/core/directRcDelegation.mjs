export const PRODUCT_RC_DELEGATOR = "help-fund";
export const PRODUCT_RC_RECIPIENT = "michael561";
export const PRODUCT_RC_DELEGATION = 1_618_000_000n;
export const PRODUCT_RC_TARGET = `${PRODUCT_RC_DELEGATOR}->${PRODUCT_RC_RECIPIENT}:${PRODUCT_RC_DELEGATION}`;
const REGENERATION_SECONDS = 432_000n;
const SAFETY_MULTIPLE = 2n;
function integer(value, label, allowZero = false) {
    if (!(allowZero ? /^[0-9]+$/u : /^[1-9][0-9]*$/u).test(value)) throw new TypeError(`${label} must be an integer string`);
    return BigInt(value);
}
function exactKeys(value, keys) {
    return Object.keys(value).sort().join(",") === [
        ...keys
    ].sort().join(",");
}
function currentMana(input, observedSeconds) {
    const maximum = integer(input.maximumRc, "maximum RC");
    const raw = integer(input.currentMana, "current mana", true);
    if (!Number.isSafeInteger(input.updatedAt) || input.updatedAt < 0) throw new TypeError("manabar update time is malformed");
    const elapsed = observedSeconds > BigInt(input.updatedAt) ? observedSeconds - BigInt(input.updatedAt) : 0n;
    const regenerated = raw + elapsed * maximum / REGENERATION_SECONDS;
    return regenerated > maximum ? maximum : regenerated;
}
export function productRcDelegationOperation() {
    const json = JSON.stringify({
        type: "delegate_rc_operation",
        value: {
            from: PRODUCT_RC_DELEGATOR,
            delegatees: [
                PRODUCT_RC_RECIPIENT
            ],
            max_rc: Number(PRODUCT_RC_DELEGATION),
            extensions: []
        }
    });
    return Object.freeze([
        "custom_json",
        Object.freeze({
            required_auths: Object.freeze([]),
            required_posting_auths: Object.freeze([
                PRODUCT_RC_DELEGATOR
            ]),
            id: "rc",
            json
        })
    ]);
}
export function assertExactProductRcDelegation(input) {
    if (input.account !== PRODUCT_RC_DELEGATOR || input.role !== "posting" || input.lane !== "product-rc-delegation" || input.target !== PRODUCT_RC_TARGET || !exactKeys(input.fields, [
        "required_auths",
        "required_posting_auths",
        "id",
        "json"
    ]) || !Array.isArray(input.fields.required_auths) || input.fields.required_auths.length !== 0 || !Array.isArray(input.fields.required_posting_auths) || input.fields.required_posting_auths.length !== 1 || input.fields.required_posting_auths[0] !== PRODUCT_RC_DELEGATOR || input.fields.id !== "rc") {
        throw new TypeError("product RC delegation requires the exact help-fund posting envelope");
    }
    let decoded;
    try {
        decoded = JSON.parse(String(input.fields.json));
    } catch  {
        throw new TypeError("product RC delegation JSON is malformed");
    }
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new TypeError("product RC delegation payload is malformed");
    const carrier = decoded;
    const value = carrier.value;
    if (!exactKeys(carrier, [
        "type",
        "value"
    ]) || carrier.type !== "delegate_rc_operation" || !value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("product RC delegation operation type changed");
    const fields = value;
    if (!exactKeys(fields, [
        "from",
        "delegatees",
        "max_rc",
        "extensions"
    ]) || fields.from !== PRODUCT_RC_DELEGATOR || !Array.isArray(fields.delegatees) || fields.delegatees.length !== 1 || fields.delegatees[0] !== PRODUCT_RC_RECIPIENT || fields.max_rc !== Number(PRODUCT_RC_DELEGATION) || !Array.isArray(fields.extensions) || fields.extensions.length !== 0) {
        throw new TypeError("product RC delegation amount, recipient, or extensions changed");
    }
    return true;
}
export function planProductRcDelegation(input) {
    const observedMs = Date.parse(input.observedAt);
    if (!Number.isFinite(observedMs)) throw new TypeError("RC observation time is malformed");
    if (input.donor.account !== PRODUCT_RC_DELEGATOR || input.recipient.account !== PRODUCT_RC_RECIPIENT) {
        throw new TypeError("product RC donor or recipient changed");
    }
    const average = integer(input.averageCustomJsonRc, "average custom_json RC");
    if (input.minimumDelegationRc.length < 2) throw new TypeError("independent minimum-delegation evidence is absent");
    const minima = input.minimumDelegationRc.map((value)=>integer(value, "minimum delegation RC"));
    const observedSeconds = BigInt(Math.floor(observedMs / 1_000));
    const donorCurrent = currentMana(input.donor, observedSeconds);
    const recipientCurrent = currentMana(input.recipient, observedSeconds);
    const donorMaximum = integer(input.donor.maximumRc, "donor maximum RC");
    const recipientMaximum = integer(input.recipient.maximumRc, "recipient maximum RC");
    const maximumMinimum = minima.reduce((left, right)=>left > right ? left : right);
    const noOutgoing = input.existingOutgoing.length === 0;
    const donorReserveAfterAllocation = donorCurrent - PRODUCT_RC_DELEGATION;
    const recipientAfterAllocation = recipientCurrent + PRODUCT_RC_DELEGATION;
    const required = average * SAFETY_MULTIPLE;
    const ready = noOutgoing && PRODUCT_RC_DELEGATION >= maximumMinimum && donorMaximum > PRODUCT_RC_DELEGATION + required && donorCurrent >= PRODUCT_RC_DELEGATION + required && recipientMaximum > 0n && recipientAfterAllocation >= required;
    const decision = ready ? "delegate-one-exact-rc-allocation" : !noOutgoing ? "refuse-existing-outgoing-delegation" : PRODUCT_RC_DELEGATION < maximumMinimum ? "refuse-below-protocol-minimum" : "refuse-rc-reserve";
    return Object.freeze({
        kind: "aagaard.product-rc-delegation-plan",
        observedAt: new Date(observedMs).toISOString(),
        decision,
        from: PRODUCT_RC_DELEGATOR,
        to: PRODUCT_RC_RECIPIENT,
        amountRc: PRODUCT_RC_DELEGATION.toString(),
        maximumObservedMinimumRc: maximumMinimum.toString(),
        averageCustomJsonRc: average.toString(),
        requiredRc: required.toString(),
        donorCurrentRc: donorCurrent.toString(),
        donorMaximumRc: donorMaximum.toString(),
        donorReserveAfterAllocationRc: donorReserveAfterAllocation.toString(),
        recipientCurrentRc: recipientCurrent.toString(),
        recipientMaximumRc: recipientMaximum.toString(),
        recipientAfterAllocationRc: recipientAfterAllocation.toString(),
        existingOutgoingCount: input.existingOutgoing.length,
        formulae: Object.freeze({
            regeneration: "R(t)=min(R_max,R_raw+floor(dt*R_max/432000))",
            donorGate: "R_donor-N>=2*R_average(custom_json)",
            recipientGate: "R_recipient+N>=2*R_average(custom_json)",
            protocolGate: "N>=max(minimum_RC_each_provider)"
        }),
        credentialAccess: false,
        chainMutation: false
    });
}

export const RC_RESERVE_SAFETY_MULTIPLE = 2n;
export const RC_REGENERATION_SECONDS = 432_000n;
function positiveInteger(value, label) {
    if (!/^[1-9][0-9]*$/u.test(value)) throw new TypeError(`${label} must be a positive integer string`);
    return BigInt(value);
}
export function planRcReserve(input) {
    const observedMs = Date.parse(input.observedAt);
    if (!Number.isFinite(observedMs)) throw new TypeError("RC observation time is malformed");
    if (input.operation.trim() === "") throw new TypeError("RC operation identity is required");
    const current = positiveInteger(input.currentRc, "current RC");
    const maximum = positiveInteger(input.maximumRc, "maximum RC");
    const average = positiveInteger(input.averageOperationRc, "average operation RC");
    if (current > maximum) throw new TypeError("current RC cannot exceed maximum RC");
    const required = average * RC_RESERVE_SAFETY_MULTIPLE;
    const ready = current >= required;
    let eligibleAt = null;
    if (ready) eligibleAt = new Date(observedMs).toISOString();
    else if (maximum >= required) {
        const missing = required - current;
        const seconds = (missing * RC_REGENERATION_SECONDS + maximum - 1n) / maximum;
        eligibleAt = new Date(observedMs + Number(seconds) * 1_000).toISOString();
    }
    return Object.freeze({
        kind: "aagaard.rc-reserve-plan",
        observedAt: new Date(observedMs).toISOString(),
        operation: input.operation,
        currentRc: current.toString(),
        maximumRc: maximum.toString(),
        averageOperationRc: average.toString(),
        requiredRc: required.toString(),
        safetyMultiple: Number(RC_RESERVE_SAFETY_MULTIPLE),
        decision: ready ? "ready" : eligibleAt ? "wait-for-rc-regeneration" : "maximum-rc-insufficient",
        eligibleAt,
        formulae: Object.freeze({
            required: "R_required=2*R_average(operation)",
            regeneration: "t=ceil((R_required-R_current)*432000/R_max)"
        }),
        credentialAccess: false,
        chainMutation: false
    });
}

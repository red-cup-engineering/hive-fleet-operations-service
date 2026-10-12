import { sizeExactPoolCycle } from "../analysis/exactPoolCycle.mjs";
import { attestProviders } from "./providerAttestation.mjs";
export const POOL_CYCLE_ASSAY_SCHEMA = "aagaard.pool-cycle-assay.v1";
export function certifyPoolCycleAssay(input) {
    const observedAt = new Date(input.observedAt).toISOString();
    if (!/^[a-z][a-z0-9.-]{2,15}$/u.test(input.account) || !/^[A-Z0-9.]{1,20}$/u.test(input.initialSymbol)) throw new TypeError("pool-cycle actor or initial token is malformed");
    if (input.observations.length < 2 || new Set(input.observations.map((row)=>row.provider)).size !== input.observations.length) throw new TypeError("pool-cycle assay requires distinct providers");
    const attested = attestProviders(input.observations);
    const { groups, unavailable } = attested;
    const knowledge = attested.value;
    const base = Object.freeze({
        schema: POOL_CYCLE_ASSAY_SCHEMA,
        observedAt,
        account: input.account,
        initialSymbol: input.initialSymbol,
        providerKnowledge: Object.freeze({
            value: knowledge,
            stateDigests: Object.freeze([
                ...groups.entries()
            ].map(([stateDigest, group])=>Object.freeze({
                    stateDigest,
                    providers: Object.freeze([
                        ...group.providers
                    ].sort())
                }))),
            unavailable: Object.freeze(unavailable)
        }),
        credentialAccess: false,
        chainMutation: false,
        executionAdmissible: false
    });
    if (knowledge !== "true") return Object.freeze({
        ...base,
        status: "uncertified",
        result: null,
        refusal: attested.refusal
    });
    const group = [
        ...groups.values()
    ][0];
    const result = sizeExactPoolCycle(group.state);
    return Object.freeze({
        ...base,
        status: "certified",
        certifyingProviders: Object.freeze([
            ...group.providers
        ].sort()),
        result,
        refusal: !result.admitted ? result.reason : result.quote.policyRefusal
    });
}

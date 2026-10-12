import { sizeExactTriangle } from "../analysis/exactTriangle.mjs";
import { attestProviders } from "./providerAttestation.mjs";
export const TRIANGLE_ASSAY_SCHEMA = "aagaard.exact-triangle-assay.v1";
export function certifyExactTriangleAssay(input) {
    const observedAt = new Date(input.observedAt).toISOString();
    if (input.observations.length < 2 || new Set(input.observations.map((row)=>row.provider)).size !== input.observations.length) {
        throw new TypeError("triangle assay requires distinct provider observations");
    }
    const attested = attestProviders(input.observations);
    const { groups, unavailable } = attested;
    const knowledge = attested.value;
    const providerKnowledge = Object.freeze({
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
    });
    const base = Object.freeze({
        schema: TRIANGLE_ASSAY_SCHEMA,
        observedAt,
        providerKnowledge,
        credentialAccess: false,
        chainMutation: false,
        executionAdmissible: false
    });
    if (knowledge !== "true") return Object.freeze({
        ...base,
        status: "uncertified",
        route: null,
        result: null,
        refusal: attested.refusal
    });
    const group = [
        ...groups.values()
    ][0];
    const state = group.state;
    const result = sizeExactTriangle(state);
    return Object.freeze({
        ...base,
        status: "certified",
        route: Object.freeze([
            state.firstPool.inputSymbol,
            state.firstPool.outputSymbol,
            state.secondPool.outputSymbol,
            state.firstPool.inputSymbol
        ]),
        account: state.account,
        certifyingProviders: Object.freeze([
            ...group.providers
        ].sort()),
        result,
        refusal: result.admitted ? null : result.reason
    });
}

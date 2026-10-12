import { semanticId } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";
import { attestationRecord, readingOfRecord, sidesOfReading } from "@red-cup-engineering/computer-data-engineering-services-section/four";
/**
 * Independent providers' observations of one exact state, read in FOUR. Each available observation's
 * state (read by `stateOf`, which may refuse) is keyed by its content address; the reading is the
 * attestation record's, in the truth family, so a certification proceeds only on "true": one state,
 * corroborated by a second provider, with no provider attesting another. A refusal names the side told:
 * contested when any provider attests another state, insufficient when nothing is corroborated.
 */ export function attestProviders(observations, stateOf = (observation)=>observation.state) {
    const groups = new Map();
    const unavailable = [];
    for (const observation of observations){
        if (observation.status === "unavailable") {
            unavailable.push(Object.freeze({
                provider: observation.provider,
                problem: observation.problem
            }));
            continue;
        }
        const state = stateOf(observation);
        const stateDigest = semanticId(state);
        const group = groups.get(stateDigest) ?? {
            state,
            providers: []
        };
        group.providers.push(observation.provider);
        groups.set(stateDigest, group);
    }
    const tally = attestationRecord([
        ...groups.values()
    ].map((group)=>group.providers.length));
    const value = readingOfRecord(tally, "truth");
    const [, contradicted] = sidesOfReading(value);
    return Object.freeze({
        value,
        tally,
        groups,
        unavailable: Object.freeze(unavailable),
        agreedState: value === "true" ? [
            ...groups.values()
        ][0].state : null,
        refusal: value === "true" ? null : contradicted ? "provider-state-contested" : "independent-provider-support-insufficient"
    });
}

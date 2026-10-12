import { canonicalJsonValue as canonicalize } from "@red-cup-engineering/json-services-section/canonical-json";
import { semanticId } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";
import { niUriDigest } from "@red-cup-engineering/uri-services-section/ni-uri";
import { tm } from "@red-cup-engineering/computer-data-engineering-services-section/semiotic-expression-notation";
/** Witness terms are SEN terms: a capability's verb is the pair of two marks, built by SEN's own constructors. */
export { tm };
export function canonicalWitnessValue(value) {
    return JSON.stringify(canonicalize(value));
}
export function witnessCell(entity, value, context, at) {
    const digest = niUriDigest(semanticId({
        entity,
        value,
        context,
        at
    })).slice(0, 16);
    return Object.freeze({
        entity,
        value,
        context,
        at,
        digest
    });
}
export function witnessLogInformation(rows) {
    const seen = new Set();
    let duplicates = 0;
    for (const row of rows){
        if (seen.has(row.digest)) duplicates += 1;
        else seen.add(row.digest);
    }
    return Object.freeze({
        rows: rows.length,
        uniqueWitnesses: seen.size,
        duplicateWitnesses: duplicates
    });
}

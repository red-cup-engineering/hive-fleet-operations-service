import { witnessChainAct } from "./journal.mjs";
import { createHash } from "node:crypto";
import { EXIT_VALUE_POSTS } from "./exitValueServicePosts.mjs";
export const EXIT_VALUE_PUBLICATION_SCHEMA = "aagaard.exit-value-service-publication.v1";
export const EXIT_VALUE_PUBLICATION_CATEGORY = "aagaard.exit-value-service-publication-event";
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const ACTOR = "urn:ame:aagaard";
export function exitValuePublicationEvent(input) {
    const spec = EXIT_VALUE_POSTS[input.kind];
    if (!spec) throw new TypeError("publication kind changed");
    if (!/^[0-9a-f]{40}$/u.test(input.transactionId) || !Number.isSafeInteger(input.block) || input.block <= 0) throw new TypeError("publication chain identity is malformed");
    const providers = [
        ...new Set(input.hiveProviders)
    ].sort();
    if (providers.length < 2 || providers.some((provider)=>!provider.startsWith("https://"))) throw new TypeError("publication lacks two Hive providers");
    const publicationId = `urn:aagaard:exit-value-service-publication:${createHash("sha256").update(JSON.stringify([
        input.kind,
        input.transactionId
    ])).digest("base64url")}`;
    return Object.freeze({
        exitValuePublicationSchema: EXIT_VALUE_PUBLICATION_SCHEMA,
        publicationId,
        recordedAt: new Date(input.recordedAt ?? new Date().toISOString()).toISOString(),
        publicationKind: input.kind,
        account: spec.account,
        permlink: spec.permlink,
        target: spec.target,
        bodySha256: spec.bodySha256,
        transactionId: input.transactionId,
        block: input.block,
        hiveProviders: Object.freeze(providers),
        roles: Object.freeze({
            curator: "emsenn0",
            publisher: "sigmund-vexler",
            merchant: "help-fund"
        }),
        terms: input.kind === "merchant" ? Object.freeze({
            price: "0.250 HBD",
            maximumPaidReports: 5,
            paymentAccount: "help-fund",
            invoiceBeforePayment: true,
            revenueRecognized: "0.000 HBD"
        }) : null,
        credentialAccess: Object.freeze({
            occurred: true,
            role: "posting",
            location: "local-0600-key"
        }),
        chainMutation: true
    });
}
async function composeExitValuePublication(_dataDir, input) {
    return exitValuePublicationEvent(input);
}
/** Record ExitValuePublication: the chain holds the act; the journal witnesses it by its transaction. */
export async function recordExitValuePublication(dataDir, ...rest) {
    const result = await composeExitValuePublication(dataDir, ...rest);
    for (const event of [result].flat()) witnessChainAct(dataDir, EXIT_VALUE_PUBLICATION_CATEGORY, event.recordedAt ?? new Date().toISOString(), event);
    return result;
}
export async function readExitValuePublications(_dataDir) {
    throw new Error("publication history must be read from Hive; local projections are retired");
}

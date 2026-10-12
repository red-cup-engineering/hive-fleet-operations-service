import { createHash } from "node:crypto";
import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";
import { EXIT_VALUE_POSTS } from "./exitValueServicePosts.mjs";

export const EXIT_VALUE_PUBLICATION_SCHEMA = "aagaard.exit-value-service-publication.v1" as const;
export const EXIT_VALUE_PUBLICATION_CATEGORY = "aagaard.exit-value-service-publication-event" as const;
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d"; const ACTOR = "urn:ame:aagaard";
export function exitValuePublicationEvent(input: Readonly<{ kind: "merchant" | "editorial"; transactionId: string; block: number;
  hiveProviders: readonly string[]; recordedAt?: string }>) {
  const spec = EXIT_VALUE_POSTS[input.kind]; if (!spec) throw new TypeError("publication kind changed");
  if (!/^[0-9a-f]{40}$/u.test(input.transactionId) || !Number.isSafeInteger(input.block) || input.block <= 0) throw new TypeError("publication chain identity is malformed");
  const providers = [...new Set(input.hiveProviders)].sort();
  if (providers.length < 2 || providers.some((provider) => !provider.startsWith("https://"))) throw new TypeError("publication lacks two Hive providers");
  const publicationId = `urn:aagaard:exit-value-service-publication:${createHash("sha256").update(JSON.stringify([input.kind, input.transactionId])).digest("base64url")}`;
  return Object.freeze({ exitValuePublicationSchema: EXIT_VALUE_PUBLICATION_SCHEMA, publicationId,
    recordedAt: new Date(input.recordedAt ?? new Date().toISOString()).toISOString(), publicationKind: input.kind,
    account: spec.account, permlink: spec.permlink, target: spec.target, bodySha256: spec.bodySha256,
    transactionId: input.transactionId, block: input.block, hiveProviders: Object.freeze(providers),
    roles: Object.freeze({ curator: "emsenn0" as const, publisher: "sigmund-vexler" as const, merchant: "help-fund" as const }),
    terms: input.kind === "merchant" ? Object.freeze({ price: "0.250 HBD" as const, maximumPaidReports: 5 as const,
      paymentAccount: "help-fund" as const, invoiceBeforePayment: true as const, revenueRecognized: "0.000 HBD" as const }) : null,
    credentialAccess: Object.freeze({ occurred: true as const, role: "posting" as const, location: "local-0600-key" as const }),
    chainMutation: true as const });
}
export async function recordExitValuePublication(dataDir: string, input: Parameters<typeof exitValuePublicationEvent>[0]) {
  const event = exitValuePublicationEvent(input); const prior = ((await querySettlementRecords(EXIT_VALUE_PUBLICATION_CATEGORY)) as readonly Readonly<Record<string, unknown>>[])
    .find((row) => row.publicationId === event.publicationId); if (prior) return prior;
  const agentUrl = process.env["RWIL_RDF_AGENT"]; if (!agentUrl) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  await recordSettlementRecord({ agentUrl, settlement: SETTLEMENT, actor: ACTOR,
    category: EXIT_VALUE_PUBLICATION_CATEGORY, recordedAt: event.recordedAt, record: event }); return event;
}
export async function readExitValuePublications(dataDir: string) { return Object.freeze(await querySettlementRecords(EXIT_VALUE_PUBLICATION_CATEGORY)); }

import { createHash } from "node:crypto";

import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";

import {
  EXIT_TIGHTNESS_PILOT_ACCOUNT,
  EXIT_TIGHTNESS_PILOT_BODY_SHA256,
  EXIT_TIGHTNESS_PILOT_MAX_REPORTS,
  EXIT_TIGHTNESS_PILOT_PERMLINK,
  EXIT_TIGHTNESS_PILOT_PRICE,
} from "./exitTightnessPilotPost.mjs";

export const PRODUCT_PILOT_SCHEMA = "aagaard.product-pilot-event.v1" as const;
export const PRODUCT_PILOT_CATEGORY = "aagaard.product-pilot-event" as const;

const AAGAARD_SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const AAGAARD_ACTOR = "urn:ame:aagaard";

export interface ProductPilotPublicationEvent {
  readonly productPilotSchema: typeof PRODUCT_PILOT_SCHEMA;
  readonly event: "offer-published";
  readonly publicationId: string;
  readonly recordedAt: string;
  readonly account: typeof EXIT_TIGHTNESS_PILOT_ACCOUNT;
  readonly permlink: typeof EXIT_TIGHTNESS_PILOT_PERMLINK;
  readonly transactionId: string;
  readonly block: number;
  readonly bodySha256: typeof EXIT_TIGHTNESS_PILOT_BODY_SHA256;
  readonly terms: {
    readonly price: typeof EXIT_TIGHTNESS_PILOT_PRICE;
    readonly maximumPaidReports: typeof EXIT_TIGHTNESS_PILOT_MAX_REPORTS;
    readonly invoiceBeforePayment: true;
    readonly revenueRecognized: "0.000 HBD";
  };
  readonly hiveProviders: readonly string[];
}

export interface ProductPilotDistributionEvent {
  readonly productPilotSchema: typeof PRODUCT_PILOT_SCHEMA;
  readonly event: "offer-distribution";
  readonly distributionId: string;
  readonly recordedAt: string;
  readonly status: "settlement-pending" | "distributed-confirmed";
  readonly account: "michael561";
  readonly author: typeof EXIT_TIGHTNESS_PILOT_ACCOUNT;
  readonly permlink: typeof EXIT_TIGHTNESS_PILOT_PERMLINK;
  readonly transactionId: string;
  readonly block: number | null;
  readonly hiveProviders: readonly string[];
  readonly audience: {
    readonly followers: number;
    readonly observedAt: string;
    readonly currentRc: string;
    readonly requiredRc: string;
  };
  readonly revenueRecognized: "0.000 HBD";
}

export type ProductPilotEvent = ProductPilotPublicationEvent | ProductPilotDistributionEvent;

export function productPilotPublicationEvent(input: {
  readonly transactionId: string;
  readonly block: number;
  readonly hiveProviders: readonly string[];
  readonly recordedAt?: string;
}): ProductPilotPublicationEvent {
  if (!/^[0-9a-f]{40}$/.test(input.transactionId)) throw new TypeError("product pilot publication needs one canonical Hive transaction id");
  if (!Number.isSafeInteger(input.block) || input.block <= 0) throw new TypeError("product pilot publication needs one positive Hive block");
  const providers = [...new Set(input.hiveProviders)].sort();
  if (providers.length < 2 || providers.some((provider) => !/^https:\/\//.test(provider))) {
    throw new TypeError("product pilot publication needs at least two distinct HTTPS Hive providers");
  }
  const recordedAt = new Date(input.recordedAt ?? new Date().toISOString()).toISOString();
  const digest = createHash("sha256").update(JSON.stringify([
    EXIT_TIGHTNESS_PILOT_ACCOUNT,
    EXIT_TIGHTNESS_PILOT_PERMLINK,
    input.transactionId,
  ])).digest("base64url");
  return Object.freeze({
    productPilotSchema: PRODUCT_PILOT_SCHEMA,
    event: "offer-published",
    publicationId: `urn:aagaard:product-pilot-publication:${digest}`,
    recordedAt,
    account: EXIT_TIGHTNESS_PILOT_ACCOUNT,
    permlink: EXIT_TIGHTNESS_PILOT_PERMLINK,
    transactionId: input.transactionId,
    block: input.block,
    bodySha256: EXIT_TIGHTNESS_PILOT_BODY_SHA256,
    terms: Object.freeze({
      price: EXIT_TIGHTNESS_PILOT_PRICE,
      maximumPaidReports: EXIT_TIGHTNESS_PILOT_MAX_REPORTS,
      invoiceBeforePayment: true,
      revenueRecognized: "0.000 HBD",
    }),
    hiveProviders: Object.freeze(providers),
  });
}

export async function recordProductPilotPublication(
  dataDir: string,
  input: Parameters<typeof productPilotPublicationEvent>[0],
): Promise<ProductPilotPublicationEvent> {
  const agentUrl = process.env["RWIL_RDF_AGENT"];
  if (!agentUrl) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  const event = productPilotPublicationEvent(input);
  const existing = ((await querySettlementRecords(PRODUCT_PILOT_CATEGORY)) as readonly ProductPilotEvent[])
    .find((candidate): candidate is ProductPilotPublicationEvent => candidate.event === "offer-published" && candidate.transactionId === event.transactionId);
  if (existing) {
    if (existing.publicationId !== event.publicationId || existing.bodySha256 !== event.bodySha256) {
      throw new Error("the publication transaction id is already bound to different product-pilot evidence");
    }
    return existing;
  }
  await recordSettlementRecord({
    agentUrl,
    root: dataDir,
    nodeId: "aagaard",
    settlement: AAGAARD_SETTLEMENT,
    actor: AAGAARD_ACTOR,
    category: PRODUCT_PILOT_CATEGORY,
    recordedAt: event.recordedAt,
    record: event,
  });
  return event;
}

export function productPilotDistributionEvent(input: Readonly<{
  status: ProductPilotDistributionEvent["status"];
  transactionId: string;
  block?: number | null;
  hiveProviders?: readonly string[];
  followers: number;
  observedAt: string;
  currentRc: string;
  requiredRc: string;
  recordedAt?: string;
}>): ProductPilotDistributionEvent {
  if (!/^[0-9a-f]{40}$/u.test(input.transactionId)) throw new TypeError("product distribution needs one canonical Hive transaction id");
  const recordedAt = new Date(input.recordedAt ?? new Date().toISOString()).toISOString();
  const observedAt = new Date(input.observedAt).toISOString();
  if (!Number.isSafeInteger(input.followers) || input.followers < 10) throw new TypeError("product distribution needs a meaningful observed audience");
  if (!/^[1-9][0-9]*$/u.test(input.currentRc) || !/^[1-9][0-9]*$/u.test(input.requiredRc)) throw new TypeError("product distribution RC evidence is malformed");
  if (BigInt(input.currentRc) < BigInt(input.requiredRc)) throw new TypeError("product distribution RC reserve was not satisfied");
  const providers = [...new Set(input.hiveProviders ?? [])].sort();
  const block = input.block ?? null;
  if (input.status === "distributed-confirmed"
    && (!Number.isSafeInteger(block) || block === null || block <= 0 || providers.length < 2 || providers.some((provider) => !/^https:\/\//u.test(provider)))) {
    throw new TypeError("confirmed product distribution needs one block and two Hive providers");
  }
  if (input.status === "settlement-pending" && (block !== null || providers.length !== 0)) {
    throw new TypeError("pending product distribution cannot carry invented confirmation evidence");
  }
  const digest = createHash("sha256").update(JSON.stringify([input.transactionId, input.status])).digest("base64url");
  return Object.freeze({ productPilotSchema: PRODUCT_PILOT_SCHEMA, event: "offer-distribution" as const,
    distributionId: `urn:aagaard:product-pilot-distribution:${digest}`, recordedAt, status: input.status,
    account: "michael561" as const, author: EXIT_TIGHTNESS_PILOT_ACCOUNT, permlink: EXIT_TIGHTNESS_PILOT_PERMLINK,
    transactionId: input.transactionId, block, hiveProviders: Object.freeze(providers),
    audience: Object.freeze({ followers: input.followers, observedAt, currentRc: input.currentRc, requiredRc: input.requiredRc }),
    revenueRecognized: "0.000 HBD" as const });
}

export async function recordProductPilotDistribution(
  dataDir: string,
  input: Parameters<typeof productPilotDistributionEvent>[0],
): Promise<ProductPilotDistributionEvent> {
  const event = productPilotDistributionEvent(input);
  const prior = ((await querySettlementRecords(PRODUCT_PILOT_CATEGORY)) as readonly ProductPilotEvent[])
    .find((candidate): candidate is ProductPilotDistributionEvent => candidate.event === "offer-distribution" && candidate.distributionId === event.distributionId);
  if (prior) return prior;
  const agentUrl = process.env["RWIL_RDF_AGENT"];
  if (!agentUrl) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  await recordSettlementRecord({ agentUrl, settlement: AAGAARD_SETTLEMENT,
    actor: AAGAARD_ACTOR, category: PRODUCT_PILOT_CATEGORY, recordedAt: event.recordedAt, record: event });
  return event;
}

export async function readProductPilotEvents(dataDir: string): Promise<readonly ProductPilotEvent[]> {
  return Object.freeze((await querySettlementRecords(PRODUCT_PILOT_CATEGORY)) as readonly ProductPilotEvent[]);
}

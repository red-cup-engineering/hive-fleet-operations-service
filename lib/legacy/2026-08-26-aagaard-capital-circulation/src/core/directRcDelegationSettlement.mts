import { createHash } from "node:crypto";

import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";
import { PRODUCT_RC_DELEGATION, PRODUCT_RC_DELEGATOR, PRODUCT_RC_RECIPIENT } from "./directRcDelegation.mts";

export const DIRECT_RC_DELEGATION_SCHEMA = "aagaard.direct-rc-delegation.v1" as const;
export const DIRECT_RC_DELEGATION_CATEGORY = "aagaard.direct-rc-delegation-event" as const;
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const ACTOR = "urn:ame:aagaard";

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Readonly<Record<string, unknown>>;
}

function providers(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} providers are absent`);
  const rows = value.map(String).sort();
  if (rows.length < 2 || new Set(rows).size !== rows.length || rows.some((row) => !row.startsWith("https://"))) {
    throw new TypeError(`${label} lacks independent providers`);
  }
  return Object.freeze(rows);
}

export function directRcDelegationEvent(receipt: Readonly<Record<string, unknown>>, recordedAt = new Date().toISOString()) {
  const status = String(receipt.status ?? ""); const transactionId = String(receipt.transactionId ?? "");
  if (receipt.kind !== "aagaard.direct-rc-delegation-receipt" || !["settlement-pending", "delegation-confirmed"].includes(status)
    || !/^[0-9a-f]{40}$/u.test(transactionId) || receipt.credentialAccess !== true || receipt.chainMutation !== true) {
    throw new TypeError("not an exact mutating direct-RC delegation receipt");
  }
  const plan = record(receipt.plan, "direct-RC plan"); const evidence = record(plan.evidence, "direct-RC evidence");
  if (plan.kind !== "aagaard.product-rc-delegation-plan" || plan.decision !== "delegate-one-exact-rc-allocation"
    || plan.from !== PRODUCT_RC_DELEGATOR || plan.to !== PRODUCT_RC_RECIPIENT
    || plan.amountRc !== PRODUCT_RC_DELEGATION.toString() || plan.credentialAccess !== false || plan.chainMutation !== false
    || evidence.knowledge !== "true") throw new TypeError("direct-RC receipt does not bind the admitted plan");
  const evidenceProviders = providers(evidence.providers, "prestate");
  const stateDigest = String(evidence.stateDigest ?? "");
  if (!/^sha256:[0-9a-f]{64}$/u.test(stateDigest)) throw new TypeError("direct-RC prestate digest is malformed");
  let hiveProviders: readonly string[] = Object.freeze([]); let delegationProviders: readonly string[] = Object.freeze([]); let block: number | null = null;
  if (status === "delegation-confirmed") {
    if (!Array.isArray(receipt.hive) || receipt.hive.length < 2) throw new TypeError("confirmed delegation lacks transaction confirmations");
    const hive = receipt.hive.map((entry) => record(entry, "Hive confirmation"));
    hiveProviders = providers(hive.map((entry) => entry.node), "transaction");
    const blocks = hive.map((entry) => Number(entry.block));
    if (blocks.some((value) => !Number.isSafeInteger(value) || value <= 0) || new Set(blocks).size !== 1) {
      throw new TypeError("Hive confirmations disagree on the delegation block");
    }
    block = blocks[0] ?? null;
    delegationProviders = providers(receipt.delegationProviders, "delegation state");
  }
  const eventId = `urn:aagaard:direct-rc-delegation:${createHash("sha256").update(`${transactionId}:${status}`).digest("base64url")}`;
  return Object.freeze({ directRcDelegationSchema: DIRECT_RC_DELEGATION_SCHEMA, eventId,
    recordedAt: new Date(recordedAt).toISOString(), status, transactionId, block,
    from: PRODUCT_RC_DELEGATOR, to: PRODUCT_RC_RECIPIENT, amountRc: PRODUCT_RC_DELEGATION.toString(),
    observedAt: new Date(String(plan.observedAt)).toISOString(), stateDigest, evidenceProviders,
    hiveProviders, delegationProviders, donorReserveAfterAllocationRc: String(plan.donorReserveAfterAllocationRc),
    recipientAfterAllocationRc: String(plan.recipientAfterAllocationRc), credentialAccess: true as const,
    chainMutation: true as const, retryAllowed: false as const });
}

export async function recordDirectRcDelegation(dataDir: string, receipt: Readonly<Record<string, unknown>>, recordedAt?: string) {
  const event = directRcDelegationEvent(receipt, recordedAt);
  const prior = ((await querySettlementRecords(DIRECT_RC_DELEGATION_CATEGORY)) as readonly Readonly<Record<string, unknown>>[])
    .find((candidate) => candidate.eventId === event.eventId);
  if (prior) return prior;
  const agentUrl = process.env["RWIL_RDF_AGENT"];
  if (!agentUrl) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  await recordSettlementRecord({ agentUrl, settlement: SETTLEMENT,
    actor: ACTOR, category: DIRECT_RC_DELEGATION_CATEGORY, recordedAt: event.recordedAt, record: event });
  return event;
}

export async function readDirectRcDelegations(dataDir: string) {
  return Object.freeze(await querySettlementRecords(DIRECT_RC_DELEGATION_CATEGORY));
}

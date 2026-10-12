import { createHash } from "node:crypto";

import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";

export const HBD_SAVINGS_RECOVERY_SCHEMA = "aagaard.hbd-savings-recovery.v1" as const;
export const HBD_SAVINGS_RECOVERY_CATEGORY = "aagaard.hbd-savings-recovery-event" as const;
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const ACTOR = "urn:ame:aagaard";
const EXIT_ID = "urn:aagaard:hbd-savings-exit:e-DK_l-iSSU2Bsfvsz6_nFbeUWt7ivM-QR6XbrBu_QU";

export interface HbdSavingsRecoveryEvent {
  readonly hbdSavingsRecoverySchema: typeof HBD_SAVINGS_RECOVERY_SCHEMA;
  readonly eventId: string;
  readonly recordedAt: string;
  readonly sourceExitEventId: typeof EXIT_ID;
  readonly account: "michael561";
  readonly requestId: 108346161;
  readonly amount: "16.298 HBD";
  readonly completeAt: "2026-07-25T04:09:27.000Z";
  readonly status: "pending" | "delivered";
  readonly observedAt: string;
  readonly stateDigest: string;
  readonly providers: readonly string[];
  readonly liquidHbd: string;
  readonly savingsHbd: string;
  readonly deliverySource: Readonly<{ historyIndex: number; block: number; timestamp: string }> | null;
  readonly credentialAccess: false;
  readonly chainMutation: false;
  readonly receipt: Readonly<Record<string, unknown>>;
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Readonly<Record<string, unknown>>;
}
function rows(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}
function hbd(value: unknown, label: string): string {
  const text = String(value ?? ""); if (!/^(?:0|[1-9][0-9]*)\.[0-9]{3} HBD$/u.test(text)) throw new TypeError(`${label} is malformed`); return text;
}

export function hbdSavingsRecoveryEvent(receipt: Readonly<Record<string, unknown>>, recordedAt = new Date().toISOString()): HbdSavingsRecoveryEvent {
  const knowledge = record(receipt.providerKnowledge, "recovery provider knowledge");
  const groups = rows(knowledge.stateDigests, "recovery state digests");
  if (receipt.kind !== "aagaard.hbd-savings-recovery-observation" || receipt.sourceExitEventId !== EXIT_ID
    || receipt.account !== "michael561" || receipt.requestId !== 108346161 || receipt.amount !== "16.298 HBD"
    || receipt.completeAt !== "2026-07-25T04:09:27.000Z" || !["pending", "delivered"].includes(String(receipt.status))
    || receipt.credentialAccess !== false || receipt.chainMutation !== false || knowledge.value !== "true" || groups.length !== 1) {
    throw new TypeError("not the exact independently known HBD savings recovery observation");
  }
  const group = record(groups[0], "recovery digest group"); const stateDigest = String(group.stateDigest ?? "");
  const providers = rows(group.providers, "recovery providers").map(String).sort(); const state = record(receipt.state, "recovery state");
  if (!/^sha256:[0-9a-f]{64}$/u.test(stateDigest) || providers.length < 2 || new Set(providers).size !== providers.length
    || state.account !== "michael561") throw new TypeError("recovery exact state support is malformed");
  const status = String(receipt.status) as "pending" | "delivered";
  const request = state.request === null ? null : record(state.request, "savings withdrawal request");
  const delivery = state.delivery === null ? null : record(state.delivery, "savings delivery source");
  if (status === "pending" && (request?.requestId !== 108346161 || request.amount !== "16.298 HBD"
    || request.from !== "michael561" || request.to !== "michael561" || request.memo !== "aagaard:hbd-savings-exit:v1"
    || request.completeAt !== "2026-07-25T04:09:27.000Z" || delivery !== null)) throw new TypeError("pending recovery lacks the exact live withdrawal");
  if (status === "delivered" && (request !== null || delivery?.requestId !== 108346161 || delivery.amount !== "16.298 HBD"
    || delivery.from !== "michael561" || delivery.to !== "michael561" || delivery.memo !== "aagaard:hbd-savings-exit:v1"
    || !Number.isSafeInteger(Number(delivery.historyIndex)) || !Number.isSafeInteger(Number(delivery.block)))) {
    throw new TypeError("delivered recovery lacks the exact fill_transfer_from_savings source");
  }
  const deliverySource = delivery === null ? null : Object.freeze({ historyIndex: Number(delivery.historyIndex), block: Number(delivery.block),
    timestamp: new Date(String(delivery.timestamp)).toISOString() });
  const observedAt = new Date(String(receipt.observedAt)).toISOString();
  const eventId = `urn:aagaard:hbd-savings-recovery:${createHash("sha256").update(JSON.stringify([status, stateDigest])).digest("base64url")}`;
  return Object.freeze({ hbdSavingsRecoverySchema: HBD_SAVINGS_RECOVERY_SCHEMA, eventId,
    recordedAt: new Date(recordedAt).toISOString(), sourceExitEventId: EXIT_ID, account: "michael561" as const,
    requestId: 108346161 as const, amount: "16.298 HBD" as const, completeAt: "2026-07-25T04:09:27.000Z" as const,
    status, observedAt, stateDigest, providers: Object.freeze(providers), liquidHbd: hbd(state.liquidHbd, "liquid HBD"),
    savingsHbd: hbd(state.savingsHbd, "savings HBD"), deliverySource,
    credentialAccess: false as const, chainMutation: false as const,
    receipt: Object.freeze(JSON.parse(JSON.stringify(receipt)) as Record<string, unknown>) });
}

export async function recordHbdSavingsRecovery(dataDir: string, receipt: Readonly<Record<string, unknown>>, recordedAt?: string) {
  const event = hbdSavingsRecoveryEvent(receipt, recordedAt);
  const prior = ((await querySettlementRecords(HBD_SAVINGS_RECOVERY_CATEGORY)) as readonly HbdSavingsRecoveryEvent[])
    .find((candidate) => candidate.eventId === event.eventId);
  if (prior) return prior;
  const agentUrl = process.env["RWIL_RDF_AGENT"];
  if (!agentUrl) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  await recordSettlementRecord({ agentUrl, settlement: SETTLEMENT,
    actor: ACTOR, category: HBD_SAVINGS_RECOVERY_CATEGORY, recordedAt: event.recordedAt, record: event });
  return event;
}

export async function readHbdSavingsRecoveries(dataDir: string): Promise<readonly HbdSavingsRecoveryEvent[]> {
  return Object.freeze((await querySettlementRecords(HBD_SAVINGS_RECOVERY_CATEGORY)) as readonly HbdSavingsRecoveryEvent[]);
}

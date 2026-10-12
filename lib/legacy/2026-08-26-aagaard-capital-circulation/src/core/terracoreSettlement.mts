import { createHash } from "node:crypto";

import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";

export const TERRACORE_ACTION_SCHEMA = "aagaard.terracore-action.v1" as const;
export const TERRACORE_ACTION_CATEGORY = "aagaard.terracore-action-event" as const;

const AAGAARD_SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const AAGAARD_ACTOR = "urn:ame:aagaard";
const FINAL_OR_PENDING = new Set([
  "claim-confirmed",
  "battle-won-confirmed",
  "battle-dodged-confirmed",
  "battle-settled-no-scrap",
  "settlement-pending",
]);

export interface TerraCoreActionEvent {
  readonly terraCoreActionSchema: typeof TERRACORE_ACTION_SCHEMA;
  readonly eventId: string;
  readonly recordedAt: string;
  readonly account: string;
  readonly transactionId: string;
  readonly status: string;
  readonly receipt: Readonly<Record<string, unknown>>;
}

function rwilAgent(): string {
  const agent = process.env["RWIL_RDF_AGENT"];
  if (!agent) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  return agent;
}

async function eventsOf(dataDir: string): Promise<readonly TerraCoreActionEvent[]> {
  return (await querySettlementRecords(TERRACORE_ACTION_CATEGORY)) as readonly TerraCoreActionEvent[];
}

function validatedReceipt(receipt: Readonly<Record<string, unknown>>): Readonly<{
  account: string;
  transactionId: string;
  status: string;
}> {
  if (receipt.kind !== "aagaard.terracore-one-action-receipt") throw new TypeError("not a TerraCore one-action receipt");
  const account = String(receipt.account ?? "");
  const transactionId = String(receipt.transactionId ?? "");
  const status = String(receipt.status ?? "");
  if (!/^[a-z][a-z0-9.-]{2,15}$/.test(account)) throw new TypeError("TerraCore receipt account is not canonical");
  if (!/^[0-9a-f]{40}$/.test(transactionId)) throw new TypeError("TerraCore receipt transaction id is not canonical");
  if (!FINAL_OR_PENDING.has(status)) throw new TypeError(`TerraCore receipt status '${status}' is not recordable`);
  return Object.freeze({ account, transactionId, status });
}

function eventIdOf(transactionId: string, status: string): string {
  const digest = createHash("sha256").update(JSON.stringify([transactionId, status])).digest("base64url");
  return `urn:aagaard:terracore-action:${digest}`;
}

export async function recordTerraCoreActionReceipt(
  dataDir: string,
  receipt: Readonly<Record<string, unknown>>,
  recordedAt = new Date().toISOString(),
): Promise<TerraCoreActionEvent> {
  const valid = validatedReceipt(receipt);
  const eventId = eventIdOf(valid.transactionId, valid.status);
  const prior = (await eventsOf(dataDir)).find((event) => event.eventId === eventId);
  if (prior) return prior;
  const event: TerraCoreActionEvent = Object.freeze({
    terraCoreActionSchema: TERRACORE_ACTION_SCHEMA,
    eventId,
    recordedAt: new Date(recordedAt).toISOString(),
    account: valid.account,
    transactionId: valid.transactionId,
    status: valid.status,
    receipt: Object.freeze({ ...receipt }),
  });
  await recordSettlementRecord({
    agentUrl: rwilAgent(),
    root: dataDir,
    nodeId: "aagaard",
    settlement: AAGAARD_SETTLEMENT,
    actor: AAGAARD_ACTOR,
    category: TERRACORE_ACTION_CATEGORY,
    recordedAt: event.recordedAt,
    record: event,
  });
  return event;
}

export async function readTerraCoreActionReceipts(dataDir: string, transactionId?: string): Promise<readonly TerraCoreActionEvent[]> {
  return Object.freeze((await eventsOf(dataDir))
    .filter((event) => transactionId === undefined || event.transactionId === transactionId)
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt)));
}

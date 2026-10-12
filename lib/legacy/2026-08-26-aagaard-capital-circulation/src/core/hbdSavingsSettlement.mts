import { createHash } from "node:crypto";

import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";

export const HBD_SAVINGS_TOUCH_SCHEMA = "aagaard.hbd-savings-touch.v1" as const;
export const HBD_SAVINGS_TOUCH_CATEGORY = "aagaard.hbd-savings-touch-event" as const;
export const HBD_SAVINGS_EXIT_SCHEMA = "aagaard.hbd-savings-exit.v1" as const;
export const HBD_SAVINGS_EXIT_CATEGORY = "aagaard.hbd-savings-exit-event" as const;

const AAGAARD_SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const AAGAARD_ACTOR = "urn:ame:aagaard";

export interface HbdSavingsTouchEvent {
  readonly hbdSavingsTouchSchema: typeof HBD_SAVINGS_TOUCH_SCHEMA;
  readonly eventId: string;
  readonly recordedAt: string;
  readonly account: string;
  readonly transactionId: string;
  readonly receipt: Readonly<Record<string, unknown>>;
}

function rwilAgent(): string {
  const agent = process.env["RWIL_RDF_AGENT"];
  if (!agent) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  return agent;
}

async function eventsOf(dataDir: string): Promise<readonly HbdSavingsTouchEvent[]> {
  return (await querySettlementRecords(HBD_SAVINGS_TOUCH_CATEGORY)) as readonly HbdSavingsTouchEvent[];
}

export async function recordHbdSavingsTouch(
  dataDir: string,
  receipt: Readonly<Record<string, unknown>>,
  recordedAt = new Date().toISOString(),
): Promise<HbdSavingsTouchEvent> {
  if (receipt.kind !== "aagaard.hbd-savings-interest-touch-receipt" || receipt.status !== "interest-confirmed") {
    throw new TypeError("only a confirmed HBD savings-interest touch receipt is recordable");
  }
  const account = String(receipt.account ?? "");
  const transactionId = String(receipt.transactionId ?? "");
  if (!/^[a-z][a-z0-9.-]{2,15}$/.test(account) || !/^[0-9a-f]{40}$/.test(transactionId)) {
    throw new TypeError("HBD savings touch receipt identity is not canonical");
  }
  const eventId = `urn:aagaard:hbd-savings-touch:${createHash("sha256").update(transactionId).digest("base64url")}`;
  const prior = (await eventsOf(dataDir)).find((event) => event.eventId === eventId);
  if (prior) return prior;
  const event: HbdSavingsTouchEvent = Object.freeze({
    hbdSavingsTouchSchema: HBD_SAVINGS_TOUCH_SCHEMA,
    eventId,
    recordedAt: new Date(recordedAt).toISOString(),
    account,
    transactionId,
    receipt: Object.freeze({ ...receipt }),
  });
  await recordSettlementRecord({
    agentUrl: rwilAgent(), settlement: AAGAARD_SETTLEMENT,
    actor: AAGAARD_ACTOR, category: HBD_SAVINGS_TOUCH_CATEGORY, recordedAt: event.recordedAt, record: event,
  });
  return event;
}

export async function readHbdSavingsTouches(dataDir: string, account?: string): Promise<readonly HbdSavingsTouchEvent[]> {
  return Object.freeze((await eventsOf(dataDir)).filter((event) => account === undefined || event.account === account));
}

export async function recordHbdSavingsExit(
  dataDir: string,
  receipt: Readonly<Record<string, unknown>>,
  recordedAt = new Date().toISOString(),
): Promise<Readonly<Record<string, unknown>>> {
  if (receipt.kind !== "aagaard.hbd-savings-exit-receipt" || !["withdrawal-queued", "settlement-pending"].includes(String(receipt.status))) {
    throw new TypeError("only a queued or pending HBD savings exit receipt is recordable");
  }
  const account = String(receipt.account ?? ""); const transactionId = String(receipt.transactionId ?? "");
  if (!/^[a-z][a-z0-9.-]{2,15}$/.test(account) || !/^[0-9a-f]{40}$/.test(transactionId)) throw new TypeError("HBD savings exit identity is not canonical");
  const status = String(receipt.status);
  const eventId = `urn:aagaard:hbd-savings-exit:${createHash("sha256").update(JSON.stringify([transactionId, status])).digest("base64url")}`;
  const prior = ((await querySettlementRecords(HBD_SAVINGS_EXIT_CATEGORY)) as readonly Record<string, unknown>[]).find((event) => event.eventId === eventId);
  if (prior) return prior;
  const event = Object.freeze({ hbdSavingsExitSchema: HBD_SAVINGS_EXIT_SCHEMA, eventId, recordedAt: new Date(recordedAt).toISOString(),
    account, transactionId, status, receipt: Object.freeze({ ...receipt }) });
  await recordSettlementRecord({ agentUrl: rwilAgent(), settlement: AAGAARD_SETTLEMENT,
    actor: AAGAARD_ACTOR, category: HBD_SAVINGS_EXIT_CATEGORY, recordedAt: event.recordedAt, record: event });
  return event;
}

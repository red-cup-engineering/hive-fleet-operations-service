import { createHash } from "node:crypto";

import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";

export const TOKEN_UNLOCK_SCHEMA = "aagaard.token-unlock.v1" as const;
export const TOKEN_UNLOCK_CATEGORY = "aagaard.token-unlock-event" as const;
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const ACTOR = "urn:ame:aagaard";

export interface TokenUnlockEvent {
  readonly tokenUnlockSchema: typeof TOKEN_UNLOCK_SCHEMA;
  readonly eventId: string;
  readonly recordedAt: string;
  readonly account: string;
  readonly symbol: string;
  readonly transactionId: string;
  readonly status: string;
  readonly receipt: Readonly<Record<string, unknown>>;
}

async function eventsOf(dataDir: string): Promise<readonly TokenUnlockEvent[]> {
  return (await querySettlementRecords(TOKEN_UNLOCK_CATEGORY)) as readonly TokenUnlockEvent[];
}

export async function recordTokenUnlock(dataDir: string, receipt: Readonly<Record<string, unknown>>, recordedAt = new Date().toISOString()): Promise<TokenUnlockEvent> {
  if (receipt.kind !== "aagaard.token-unstake-receipt") throw new TypeError("not a token unstake receipt");
  const account = String(receipt.account ?? ""); const symbol = String(receipt.symbol ?? "");
  const transactionId = String(receipt.transactionId ?? ""); const status = String(receipt.status ?? "");
  if (!/^[a-z][a-z0-9.-]{2,15}$/.test(account) || !/^[A-Z][A-Z0-9.]{0,9}$/.test(symbol)
    || !/^[0-9a-f]{40}$/.test(transactionId) || !["unstake-start-confirmed", "settlement-pending"].includes(status)) {
    throw new TypeError("token unlock receipt identity or status is not recordable");
  }
  const eventId = `urn:aagaard:token-unlock:${createHash("sha256").update(JSON.stringify([transactionId, status])).digest("base64url")}`;
  const prior = (await eventsOf(dataDir)).find((event) => event.eventId === eventId); if (prior) return prior;
  const event: TokenUnlockEvent = Object.freeze({ tokenUnlockSchema: TOKEN_UNLOCK_SCHEMA, eventId,
    recordedAt: new Date(recordedAt).toISOString(), account, symbol, transactionId, status, receipt: Object.freeze({ ...receipt }) });
  const agentUrl = process.env["RWIL_RDF_AGENT"];
  if (!agentUrl) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  await recordSettlementRecord({ agentUrl, settlement: SETTLEMENT,
    actor: ACTOR, category: TOKEN_UNLOCK_CATEGORY, recordedAt: event.recordedAt, record: event });
  return event;
}

export async function readTokenUnlocks(dataDir: string, account?: string): Promise<readonly TokenUnlockEvent[]> {
  return Object.freeze((await eventsOf(dataDir)).filter((event) => account === undefined || event.account === account));
}

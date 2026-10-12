import { createHash } from "node:crypto";

import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";

export const HOLOZING_WILDS_SESSION_SCHEMA = "aagaard.holozing-wilds-session.v1" as const;
export const HOLOZING_WILDS_SESSION_CATEGORY = "aagaard.holozing-wilds-session-event" as const;

const AAGAARD_SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const AAGAARD_ACTOR = "urn:ame:aagaard";

export interface HolozingWildsSessionEvent {
  readonly holozingWildsSessionSchema: typeof HOLOZING_WILDS_SESSION_SCHEMA;
  readonly eventId: string;
  readonly recordedAt: string;
  readonly account: string;
  readonly completedAt: string;
  readonly metrics: Readonly<{ dustDelta: number; wildsDefeatedDelta: number; heals: number; captureActions: number }>;
  readonly protectedAlphaVialPreserved: true;
  readonly transferableAssetCreated: false;
  readonly revenueRecognized: "0.000 HIVE";
  readonly receipt: Readonly<Record<string, unknown>>;
}

function finite(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function validateReceipt(receipt: Readonly<Record<string, unknown>>) {
  if (receipt.kind !== "aagaard.holozing-wilds-receipt" || receipt.authenticated !== true) throw new TypeError("not an authenticated HoloZing Wilds receipt");
  const account = String(receipt.account ?? "");
  if (!/^[a-z][a-z0-9.-]{2,15}$/u.test(account)) throw new TypeError("Wilds receipt account is not canonical");
  if (receipt.nftStarterSelected !== false) throw new TypeError("Wilds receipt does not prove that no NFT starter was selected");
  const reconciliation = receipt.reconciliation as Record<string, unknown> | undefined;
  if (reconciliation?.confirmed !== true || reconciliation.reserveRetained !== true || reconciliation.captureActionsSettled !== true) {
    throw new TypeError("Wilds receipt is not independently reconciled and reserve-safe");
  }
  const captures = finite(receipt.captureActionsSent, "capture action count");
  if (!Number.isSafeInteger(captures) || captures < 0 || captures > 3) throw new TypeError("Wilds capture count is outside the bounded operator");
  if (captures === 0 && (finite(reconciliation.captureAttemptsDelta, "capture attempt delta") !== 0
    || finite(reconciliation.captureSuccessDelta, "capture success delta") !== 0
    || finite(reconciliation.captureFailDelta, "capture fail delta") !== 0
    || reconciliation.captureOutcome !== "not-requested")) throw new TypeError("no-capture Wilds receipt has changed capture counters");
  const initialDust = finite(receipt.initialDust, "initial Dust"); const finalDust = finite(receipt.finalDust, "final Dust");
  const dustDelta = finite(reconciliation.dustDelta, "Dust delta");
  if (Math.round((finalDust - initialDust) * 100) / 100 !== dustDelta) throw new TypeError("Wilds Dust delta does not match the authoritative snapshots");
  const wilds = finite(reconciliation.wildsDefeatedDelta, "wilds defeated delta");
  const heals = finite(receipt.heals, "heal count");
  if (!Number.isSafeInteger(wilds) || wilds < 0 || !Number.isSafeInteger(heals) || heals < 0) throw new TypeError("Wilds counters are malformed");
  const completedAt = new Date(String(receipt.completedAt ?? "")).toISOString();
  const initialClock = finite((receipt.initialState as Record<string, unknown> | undefined)?.clock, "initial session clock");
  const finalClock = finite((receipt.finalState as Record<string, unknown> | undefined)?.clock, "final session clock");
  if (!(finalClock >= initialClock)) throw new TypeError("Wilds session clocks are reversed");
  return Object.freeze({ account, completedAt, initialClock, finalClock, captures, dustDelta, wilds, heals });
}

export function holozingWildsSessionEvent(receipt: Readonly<Record<string, unknown>>, recordedAt = new Date().toISOString()): HolozingWildsSessionEvent {
  const valid = validateReceipt(receipt);
  const digest = createHash("sha256").update(JSON.stringify([valid.account, valid.completedAt, valid.initialClock, valid.finalClock])).digest("base64url");
  return Object.freeze({ holozingWildsSessionSchema: HOLOZING_WILDS_SESSION_SCHEMA,
    eventId: `urn:aagaard:holozing-wilds-session:${digest}`, recordedAt: new Date(recordedAt).toISOString(),
    account: valid.account, completedAt: valid.completedAt,
    metrics: Object.freeze({ dustDelta: valid.dustDelta, wildsDefeatedDelta: valid.wilds, heals: valid.heals, captureActions: valid.captures }),
    protectedAlphaVialPreserved: true as const, transferableAssetCreated: false as const, revenueRecognized: "0.000 HIVE" as const,
    receipt: Object.freeze({ ...receipt }) });
}

export async function recordHolozingWildsSession(dataDir: string, receipt: Readonly<Record<string, unknown>>, recordedAt?: string) {
  const event = holozingWildsSessionEvent(receipt, recordedAt);
  const prior = ((await querySettlementRecords(HOLOZING_WILDS_SESSION_CATEGORY)) as readonly HolozingWildsSessionEvent[])
    .find((candidate) => candidate.eventId === event.eventId);
  if (prior) return prior;
  const agentUrl = process.env["RWIL_RDF_AGENT"];
  if (!agentUrl) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  await recordSettlementRecord({ agentUrl, settlement: AAGAARD_SETTLEMENT,
    actor: AAGAARD_ACTOR, category: HOLOZING_WILDS_SESSION_CATEGORY, recordedAt: event.recordedAt, record: event });
  return event;
}

export async function readHolozingWildsSessions(dataDir: string): Promise<readonly HolozingWildsSessionEvent[]> {
  return Object.freeze((await querySettlementRecords(HOLOZING_WILDS_SESSION_CATEGORY)) as readonly HolozingWildsSessionEvent[]);
}

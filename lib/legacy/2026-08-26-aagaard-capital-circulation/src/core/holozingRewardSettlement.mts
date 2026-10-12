import { createHash } from "node:crypto";

import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";

export const HOLOZING_REWARD_CLAIM_SCHEMA = "aagaard.holozing-reward-claim.v1" as const;
export const HOLOZING_REWARD_CLAIM_CATEGORY = "aagaard.holozing-reward-claim-event" as const;
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const ACTOR = "urn:ame:aagaard";
const STATUSES = new Set(["claimed-confirmed", "claim-submission-unknown-do-not-retry", "claim-submitted-unreconciled-do-not-retry"]);

export interface HolozingRewardClaimEvent {
  readonly holozingRewardClaimSchema: typeof HOLOZING_REWARD_CLAIM_SCHEMA;
  readonly eventId: string;
  readonly recordedAt: string;
  readonly account: "michael561";
  readonly status: string;
  readonly transactionId: string | null;
  readonly claimedZing: string | null;
  readonly alphaVial1831Preserved: true;
  readonly retryAllowed: false;
  readonly realizedRevenue: "0.000 HIVE";
  readonly receipt: Readonly<Record<string, unknown>>;
}

function object(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Readonly<Record<string, unknown>>;
}
function units3(value: unknown, label: string): bigint {
  const text = String(value ?? ""); const match = /^(?:0|[1-9][0-9]*)\.([0-9]{3})$/u.exec(text);
  if (!match) throw new TypeError(`${label} must have exactly three decimals`);
  return BigInt(text.replace(".", ""));
}
function vial(observation: Readonly<Record<string, unknown>>, label: string): void {
  const alpha = object(observation.alphaVials, `${label} Alpha Vials`);
  if (alpha.count !== 1 || JSON.stringify(alpha.ids) !== "[1831]" || alpha.disposition !== "preserved-unopened") {
    throw new TypeError(`${label} does not preserve Alpha Vial #1831`);
  }
}
function providers(value: unknown, label: string): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value) || value.length < 2) throw new TypeError(`${label} lacks independent witnesses`);
  const rows = value.map((row) => object(row, label)); const names = rows.map((row) => String(row.node ?? ""));
  if (new Set(names).size !== names.length || names.some((name) => !name.startsWith("https://"))) throw new TypeError(`${label} witnesses are malformed`);
  return rows;
}

export function holozingRewardClaimEvent(receipt: Readonly<Record<string, unknown>>, recordedAt = new Date().toISOString()): HolozingRewardClaimEvent {
  if (receipt.kind !== "aagaard.holozing-reward-claim-receipt" || receipt.account !== "michael561") throw new TypeError("not the admitted HoloZing reward claim receipt");
  const status = String(receipt.status ?? ""); if (!STATUSES.has(status) || receipt.retryAllowed !== false) throw new TypeError("HoloZing claim status is not durably recordable");
  const observedAt = new Date(String(receipt.observedAt ?? "")).toISOString();
  const before = object(receipt.before, "pre-claim observation"); vial(before, "pre-claim observation"); providers(receipt.providers, "pre-claim balance");
  const pending = object(before.pending, "pre-claim pending rewards"); const zing = object(before.zing, "pre-claim ZING balance");
  const plan = object(receipt.plan, "claim plan");
  if (plan.kind !== "ready" || units3(plan.minimumClaimZing, "planned claim") !== units3(pending.total, "pending reward total")
    || units3(pending.total, "pending reward total") < 1_000n) throw new TypeError("claim receipt is not bound to an eligible exact reward total");
  const transactionText = receipt.transactionId === undefined ? "" : String(receipt.transactionId);
  const transactionId = transactionText === "" ? null : transactionText;
  if (transactionId !== null && !/^[0-9a-f]{40}$/iu.test(transactionId)) throw new TypeError("HoloZing claim transaction id is malformed");
  let claimedZing: string | null = null;
  if (status === "claimed-confirmed") {
    if (transactionId === null) throw new TypeError("confirmed HoloZing claim lacks a transaction id");
    claimedZing = String(receipt.claimedZing ?? ""); const claimed = units3(claimedZing, "claimed ZING");
    if (claimed !== units3(pending.total, "pending reward total")) throw new TypeError("confirmed HoloZing claim differs from the planned reward total");
    const confirmations = providers(receipt.engineConfirmations, "claim execution");
    const blocks = confirmations.map((row) => Number(row.blockNumber));
    if (blocks.some((block) => !Number.isSafeInteger(block) || block <= 0) || new Set(blocks).size !== 1) throw new TypeError("claim execution witnesses disagree on one block");
    if (!Array.isArray(receipt.stakeEvents) || receipt.stakeEvents.length < 1) throw new TypeError("confirmed claim has no exact stake events");
    let eventTotal = 0n;
    for (const value of receipt.stakeEvents) { const row = object(value, "claim stake event");
      if (!String(row.childTransactionId ?? "").startsWith(`${transactionId}-`) || Number(row.blockNumber) !== blocks[0]
        || !String(row.memo ?? "").startsWith("Your claim for ")) throw new TypeError("claim stake event does not bind the parent transaction");
      eventTotal += units3(row.quantity, "stake event quantity"); }
    if (eventTotal !== claimed) throw new TypeError("claim stake events do not sum to claimed ZING");
    const after = object(receipt.after, "post-claim observation"); vial(after, "post-claim observation");
    const afterZing = object(after.zing, "post-claim ZING balance"); const afterPending = object(after.pending, "post-claim pending rewards");
    if (units3(afterZing.liquid, "post-claim liquid ZING") !== units3(zing.liquid, "pre-claim liquid ZING")
      || units3(afterZing.staked, "post-claim staked ZING") - units3(zing.staked, "pre-claim staked ZING") !== claimed
      || units3(afterPending.total, "post-claim pending rewards") >= units3(pending.total, "pre-claim pending rewards")) {
      throw new TypeError("confirmed HoloZing claim does not satisfy the exact balance and pending-reward effects");
    }
  }
  const identity = transactionId ?? observedAt;
  const eventId = `urn:aagaard:holozing-reward-claim:${createHash("sha256").update(JSON.stringify([identity, status])).digest("base64url")}`;
  return Object.freeze({ holozingRewardClaimSchema: HOLOZING_REWARD_CLAIM_SCHEMA, eventId,
    recordedAt: new Date(recordedAt).toISOString(), account: "michael561" as const, status, transactionId, claimedZing,
    alphaVial1831Preserved: true as const, retryAllowed: false as const, realizedRevenue: "0.000 HIVE" as const,
    receipt: JSON.parse(JSON.stringify(receipt)) as Readonly<Record<string, unknown>> });
}

export async function recordHolozingRewardClaim(dataDir: string, receipt: Readonly<Record<string, unknown>>, recordedAt?: string) {
  const event = holozingRewardClaimEvent(receipt, recordedAt);
  const prior = ((await querySettlementRecords(HOLOZING_REWARD_CLAIM_CATEGORY)) as readonly HolozingRewardClaimEvent[]).find((row) => row.eventId === event.eventId);
  if (prior) return prior;
  const agentUrl = process.env["RWIL_RDF_AGENT"];
  if (!agentUrl) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  await recordSettlementRecord({ agentUrl, settlement: SETTLEMENT,
    actor: ACTOR, category: HOLOZING_REWARD_CLAIM_CATEGORY, recordedAt: event.recordedAt, record: event });
  return event;
}

export async function readHolozingRewardClaims(dataDir: string): Promise<readonly HolozingRewardClaimEvent[]> {
  return Object.freeze((await querySettlementRecords(HOLOZING_REWARD_CLAIM_CATEGORY)) as readonly HolozingRewardClaimEvent[]);
}

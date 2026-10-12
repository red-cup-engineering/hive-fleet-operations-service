// core/curationSettlement — append-only curation vote lots.
//
// Aagaard's voting scorer currently predicts only a dimensionless strategy
// signal.  Hive settles curation in VESTS.  This carrier preserves both facts
// without silently treating the former as a prediction of the latter and
// without inventing an HBD conversion.

import { createHash } from "node:crypto";

import { readSettlementRecords, recordSettlementRecord } from "@emsenn/rwil-rdf-services/client";

import type { VotePlanItem, VotingExecution } from "./core.adapter.ts";

export const CURATION_VOTE_LOT_SCHEMA = "aagaard.curation-vote-lot.v1" as const;
export const CURATION_VOTE_LOT_CATEGORY = "aagaard.curation-vote-lot-event" as const;

const AAGAARD_SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const AAGAARD_ACTOR = "urn:ame:aagaard";

export interface CurationRewardOperation {
  readonly sourceId: string;
  readonly account: string;
  readonly historyIndex: number;
  readonly block: number;
  readonly operationIndex: number;
  readonly timestamp: string;
  readonly author: string;
  readonly permlink: string;
  readonly reward: { readonly amount: string; readonly asset: "VESTS" };
  readonly payoutMustBeClaimed: boolean | null;
}

export interface CurationRewardScan {
  readonly kind: "aagaard.hive-curation-reward-scan";
  readonly account: string;
  readonly requestedLimit: number;
  readonly newestHistoryIndex: number | null;
  readonly oldestHistoryIndex: number | null;
  readonly rewards: readonly CurationRewardOperation[];
}

export interface CurationPredictionEvent {
  readonly curationVoteLotSchema: typeof CURATION_VOTE_LOT_SCHEMA;
  readonly event: "prediction-recorded";
  readonly predictionId: string;
  readonly recordedAt: string;
  readonly account: string;
  readonly author: string;
  readonly permlink: string;
  readonly vote: { readonly weightBps: number; readonly txId: string };
  readonly prediction: {
    readonly signal: number;
    readonly unit: "aagaard.curation-strategy-signal.v1";
    readonly rewardVests: null;
  };
}

export interface CurationSettlementEvent {
  readonly curationVoteLotSchema: typeof CURATION_VOTE_LOT_SCHEMA;
  readonly event: "settlement-observed";
  readonly recordedAt: string;
  readonly source: CurationRewardOperation;
  readonly matchedPredictionId: string | null;
  readonly matchedPredictionSignal: number | null;
  readonly valuation: {
    readonly hbd: null;
    readonly reason: "no-admitted-vests-to-hbd-valuation";
  };
}

export type CurationVoteLotEvent = CurationPredictionEvent | CurationSettlementEvent;

export interface CurationTelemetry {
  readonly kind: "aagaard.curation-settlement-telemetry";
  readonly account: string;
  readonly predictionsRecorded: number;
  readonly settlementsObserved: number;
  readonly settlementsMatchedToPredictions: number;
  readonly settlementsWithoutPrediction: number;
  readonly matchedPredictionSignalProxy: number;
  readonly predictedRewardVests: null;
  readonly realizedReward: { readonly amount: string; readonly asset: "VESTS" };
  readonly predictionErrorVests: null;
  readonly realizedRewardHbd: null;
  readonly comparisonStatus: "proxy-and-settlement-not-commensurate";
  readonly historyScan: "available" | "unavailable" | "not-run";
  readonly gaps: readonly string[];
}

function rwilAgent(): string {
  const agent = process.env["RWIL_RDF_AGENT"];
  if (!agent) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  return agent;
}

function eventsOf(dataDir: string): readonly CurationVoteLotEvent[] {
  return readSettlementRecords(dataDir, CURATION_VOTE_LOT_CATEGORY) as readonly CurationVoteLotEvent[];
}

async function append(dataDir: string, recordedAt: string, record: CurationVoteLotEvent): Promise<void> {
  await recordSettlementRecord({
    agentUrl: rwilAgent(),
    root: dataDir,
    nodeId: "aagaard",
    settlement: AAGAARD_SETTLEMENT,
    actor: AAGAARD_ACTOR,
    category: CURATION_VOTE_LOT_CATEGORY,
    recordedAt,
    record,
  });
}

function predictionId(account: string, vote: VotePlanItem, txId: string): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([account, vote.author, vote.permlink, txId]))
    .digest("base64url");
  return `urn:aagaard:curation-prediction:${digest}`;
}

/** Append prediction lots only for votes the Hive write boundary reported as
 * broadcast. Dry runs, proposals, skips, and errors are not economic lots. */
export async function recordCurationPredictions(
  dataDir: string,
  account: string,
  votes: readonly VotePlanItem[],
  execution: VotingExecution,
  recordedAt: string,
): Promise<readonly CurationPredictionEvent[]> {
  const existing = new Set(eventsOf(dataDir)
    .filter((event): event is CurationPredictionEvent => event.event === "prediction-recorded")
    .map((event) => event.predictionId));
  const byTarget = new Map<string, VotePlanItem>(votes.map((vote) => [`${vote.author}/${vote.permlink}`, vote]));
  const appended: CurationPredictionEvent[] = [];

  for (const receipt of execution.receipts) {
    if (receipt.lane !== "voting" || receipt.action !== "vote" || receipt.status !== "broadcast" || !receipt.txId) continue;
    const vote = byTarget.get(receipt.target);
    if (!vote) continue;
    const id = predictionId(account, vote, receipt.txId);
    if (existing.has(id)) continue;
    const event: CurationPredictionEvent = Object.freeze({
      curationVoteLotSchema: CURATION_VOTE_LOT_SCHEMA,
      event: "prediction-recorded",
      predictionId: id,
      recordedAt,
      account,
      author: vote.author,
      permlink: vote.permlink,
      vote: Object.freeze({ weightBps: vote.weightBps, txId: receipt.txId }),
      prediction: Object.freeze({
        signal: vote.strategyAlpha,
        unit: "aagaard.curation-strategy-signal.v1" as const,
        rewardVests: null,
      }),
    });
    await append(dataDir, recordedAt, event);
    existing.add(id);
    appended.push(event);
  }
  return Object.freeze(appended);
}

/** Append every newly observed curation_reward operation, joining it to the
 * latest preceding prediction for the same account/post when one exists.
 * Source identity deliberately excludes trx_id: virtual operations commonly
 * carry the same all-zero transaction id. */
export async function recordCurationSettlements(
  dataDir: string,
  scan: CurationRewardScan,
  recordedAt: string,
): Promise<readonly CurationSettlementEvent[]> {
  const prior = eventsOf(dataDir);
  const predictions = prior
    .filter((event): event is CurationPredictionEvent => event.event === "prediction-recorded" && event.account === scan.account)
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
  const settlements = prior.filter((event): event is CurationSettlementEvent => event.event === "settlement-observed");
  const seenSources = new Set(settlements.map((event) => event.source.sourceId));
  const matchedPredictions = new Set(settlements.flatMap((event) => event.matchedPredictionId ? [event.matchedPredictionId] : []));
  const appended: CurationSettlementEvent[] = [];

  const ordered = [...scan.rewards].sort((left, right) => left.historyIndex - right.historyIndex);
  for (const source of ordered) {
    if (seenSources.has(source.sourceId)) continue;
    const match = predictions
      .filter((prediction) => prediction.author === source.author
        && prediction.permlink === source.permlink
        && prediction.recordedAt <= source.timestamp
        && !matchedPredictions.has(prediction.predictionId))
      .at(-1) ?? null;
    const event: CurationSettlementEvent = Object.freeze({
      curationVoteLotSchema: CURATION_VOTE_LOT_SCHEMA,
      event: "settlement-observed",
      recordedAt,
      source,
      matchedPredictionId: match?.predictionId ?? null,
      matchedPredictionSignal: match?.prediction.signal ?? null,
      valuation: Object.freeze({ hbd: null, reason: "no-admitted-vests-to-hbd-valuation" as const }),
    });
    await append(dataDir, recordedAt, event);
    seenSources.add(source.sourceId);
    if (match) matchedPredictions.add(match.predictionId);
    appended.push(event);
  }
  return Object.freeze(appended);
}

function vestsMicros(amount: string): bigint {
  const match = /^(\d+)(?:\.(\d{0,6}))?$/.exec(amount);
  if (!match) throw new Error(`invalid VESTS amount ${amount}`);
  return BigInt(match[1]!) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"));
}

function formatVests(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const fraction = (micros % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${fraction}`;
}

export function readCurationTelemetry(
  dataDir: string,
  account: string,
  historyScan: CurationTelemetry["historyScan"] = "not-run",
): CurationTelemetry {
  const events = eventsOf(dataDir);
  const predictions = events.filter((event): event is CurationPredictionEvent => event.event === "prediction-recorded" && event.account === account);
  const settlements = events.filter((event): event is CurationSettlementEvent => event.event === "settlement-observed" && event.source.account === account);
  const matched = settlements.filter((event) => event.matchedPredictionId !== null);
  const realizedMicros = settlements.reduce((sum, event) => sum + vestsMicros(event.source.reward.amount), 0n);
  const signal = matched.reduce((sum, event) => sum + (event.matchedPredictionSignal ?? 0), 0);
  return Object.freeze({
    kind: "aagaard.curation-settlement-telemetry" as const,
    account,
    predictionsRecorded: predictions.length,
    settlementsObserved: settlements.length,
    settlementsMatchedToPredictions: matched.length,
    settlementsWithoutPrediction: settlements.length - matched.length,
    matchedPredictionSignalProxy: Number(signal.toFixed(3)),
    predictedRewardVests: null,
    realizedReward: Object.freeze({ amount: formatVests(realizedMicros), asset: "VESTS" as const }),
    predictionErrorVests: null,
    realizedRewardHbd: null,
    comparisonStatus: "proxy-and-settlement-not-commensurate" as const,
    historyScan,
    gaps: Object.freeze([
      "strategy-signal-is-not-a-vests-prediction",
      "no-admitted-vests-to-hbd-valuation",
      "account-history-scan-is-bounded-not-full-chain-history",
      ...(historyScan === "unavailable" ? ["current-account-history-scan-unavailable"] : []),
    ]),
  });
}

import { createHash } from "node:crypto";

import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";

export const CURATION_ACTION_SCHEMA = "aagaard.curation-action.v1" as const;
export const CURATION_ACTION_CATEGORY = "aagaard.curation-action-event" as const;

const AAGAARD_SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const AAGAARD_ACTOR = "urn:ame:aagaard";

export interface CurationActionEvent {
  readonly curationActionSchema: typeof CURATION_ACTION_SCHEMA;
  readonly eventId: string;
  readonly recordedAt: string;
  readonly account: string;
  readonly transactionId: string;
  readonly block: number;
  readonly author: string;
  readonly permlink: string;
  readonly weightBps: number;
  readonly credentialLocation: "cold-red-gate" | "local-key-file";
  readonly confirmationProviders: readonly string[];
  readonly visibilityProviders: readonly string[];
  readonly predictionId: string;
  readonly economicSettlement: "pending-curation-reward";
  readonly realizedReward: null;
  readonly receipt: Readonly<Record<string, unknown>>;
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Readonly<Record<string, unknown>>;
}

function canonicalAccount(value: unknown, label: string): string {
  const account = String(value ?? "");
  if (!/^[a-z][a-z0-9.-]{2,15}$/u.test(account)) throw new TypeError(`${label} is not canonical`);
  return account;
}

function distinctProviders(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const providers = value.map(String);
  if (providers.length < 2 || new Set(providers).size !== providers.length || providers.some((provider) => !/^https:\/\//u.test(provider))) {
    throw new TypeError(`${label} lacks independent providers`);
  }
  return Object.freeze([...providers].sort());
}

export function curationActionEvent(receipt: Readonly<Record<string, unknown>>, recordedAt = new Date().toISOString()): CurationActionEvent {
  if (receipt.kind !== "aagaard.curation-one-vote-receipt" || receipt.status !== "vote-observed") {
    throw new TypeError("not a completed curation one-vote receipt");
  }
  const account = canonicalAccount(receipt.account, "curation actor");
  const transactionId = String(receipt.transactionId ?? "");
  if (!/^[0-9a-f]{40}$/u.test(transactionId)) throw new TypeError("curation transaction id is not canonical");
  const plan = record(receipt.plan, "curation plan");
  const author = canonicalAccount(plan.author, "curation author");
  const permlink = String(plan.permlink ?? "");
  const weightBps = Number(plan.weightBps);
  if (!/^[a-z0-9-]{1,255}$/u.test(permlink) || !Number.isSafeInteger(weightBps) || weightBps < 1 || weightBps > 5_000) {
    throw new TypeError("curation target or vote weight is outside the bounded lane");
  }
  const confirmations = Array.isArray(receipt.hive) ? receipt.hive.map((entry) => record(entry, "Hive confirmation")) : [];
  const confirmationProviders = distinctProviders(confirmations.map((entry) => entry.node), "transaction confirmations");
  const blocks = confirmations.map((entry) => Number(entry.block));
  if (blocks.some((block) => !Number.isSafeInteger(block) || block <= 0) || new Set(blocks).size !== 1) {
    throw new TypeError("transaction confirmations do not agree on one block");
  }
  const immediate = record(receipt.immediateEffect, "curation immediate effect");
  if (immediate.confirmed !== true) throw new TypeError("curation vote is not visibly confirmed");
  const visibilityProviders = distinctProviders(immediate.visibleProviders, "vote visibility");
  const credential = record(receipt.credentialAccess, "credential access");
  const location = credential.location;
  if (credential.occurred !== true || credential.role !== "posting"
    || (location !== "cold-red-gate" && location !== "local-key-file")) throw new TypeError("credential evidence is malformed");
  const settlement = record(receipt.settlementIdentity, "curation settlement identity");
  if (settlement.account !== account || settlement.author !== author || settlement.permlink !== permlink
    || settlement.transactionId !== transactionId || settlement.expectedOperation !== "curation_reward"
    || settlement.rewardAsset !== "VESTS" || settlement.status !== "pending-payout") {
    throw new TypeError("curation settlement identity does not bind the vote");
  }
  const durable = record(receipt.durableRecord, "curation prediction record");
  const predictionId = String(durable.predictionId ?? "");
  if (durable.confirmed !== true || !/^urn:aagaard:curation-prediction:[A-Za-z0-9_-]+$/u.test(predictionId)) {
    throw new TypeError("curation prediction was not durably recorded");
  }
  const eventId = `urn:aagaard:curation-action:${createHash("sha256").update(JSON.stringify([transactionId, blocks[0]])).digest("base64url")}`;
  return Object.freeze({ curationActionSchema: CURATION_ACTION_SCHEMA, eventId,
    recordedAt: new Date(recordedAt).toISOString(), account, transactionId, block: blocks[0]!, author, permlink, weightBps,
    credentialLocation: location, confirmationProviders, visibilityProviders, predictionId,
    economicSettlement: "pending-curation-reward" as const, realizedReward: null,
    receipt: JSON.parse(JSON.stringify(receipt)) as Readonly<Record<string, unknown>> });
}

export async function recordCurationAction(dataDir: string, receipt: Readonly<Record<string, unknown>>, recordedAt?: string) {
  const event = curationActionEvent(receipt, recordedAt);
  const prior = ((await querySettlementRecords(CURATION_ACTION_CATEGORY)) as readonly CurationActionEvent[])
    .find((candidate) => candidate.eventId === event.eventId);
  if (prior) return prior;
  const agentUrl = process.env["RWIL_RDF_AGENT"];
  if (!agentUrl) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  await recordSettlementRecord({ agentUrl, settlement: AAGAARD_SETTLEMENT,
    actor: AAGAARD_ACTOR, category: CURATION_ACTION_CATEGORY, recordedAt: event.recordedAt, record: event });
  return event;
}

export async function readCurationActions(dataDir: string): Promise<readonly CurationActionEvent[]> {
  return Object.freeze((await querySettlementRecords(CURATION_ACTION_CATEGORY)) as readonly CurationActionEvent[]);
}

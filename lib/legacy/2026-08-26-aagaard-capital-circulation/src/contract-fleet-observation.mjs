#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { semanticId } from "@red-cup-engineering/rmn-semantic-conformance";
import { queryRwilDocumentsByCategory, recordSettlementRecord, relationalRwilDocument } from "@lenticule-science/rwil-rdf-projection-service/client";

import { HIVE_FLEET_CUSTODY_OBSERVATION_CONTRACT } from "./law.mjs";

const CONTEXT = "https://www.w3.org/ns/activitystreams";
const ACTOR = "urn:ame:aagaard";
const NODE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const FLEET_TICK_CATEGORY = "aagaard.fleet-tick";
const EFFECTS = ["provider-local-rwil-evidence"];

export function digest(value) { return semanticId(relationalRwilDocument(value)); }
function identify(body) { return { id: digest(body), ...body }; }
function contentValid(value) { const { id: _id, ...body } = value ?? {}; return value?.id === digest(body); }
function arg(flag) { const index = process.argv.indexOf(flag); return index < 0 ? undefined : process.argv[index + 1]; }
function operation() {
  const invoked = basename(process.argv[1] ?? "");
  return arg("--operation") ?? (["solicit-service", "invoke-service"].includes(invoked) ? invoked : "invoke-service");
}
function instant() { return arg("--now") ?? new Date().toISOString(); }
function dataRoot(env = process.env) { return resolve(env.AAGAARD_CONTRACT_DATA_ROOT ?? join(NODE_ROOT, "data")); }
function rwilAgent(env = process.env) {
  if (!env.RWIL_RDF_AGENT) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  return env.RWIL_RDF_AGENT;
}
async function append(root, category, record, at, env) {
  return recordSettlementRecord({ agentUrl: rwilAgent(env), settlement: SETTLEMENT,
    actor: ACTOR, category, recordedAt: at, record });
}
function response(type, source, object, at) {
  return identify({ "@context": CONTEXT, type, actor: ACTOR, target: source?.actor ?? null,
    inReplyTo: source?.id ?? null, law: HIVE_FLEET_CUSTODY_OBSERVATION_CONTRACT, object, published: at });
}
async function reject(root, source, reason, at, env) {
  const value = response("Reject", source, { type: "HiveFleetCustodyObservationRefusal",
    law: HIVE_FLEET_CUSTODY_OBSERVATION_CONTRACT, reason, prohibitedEffectsPerformed: false,
    credentialAccess: false, chainMutation: false, customerMutation: false, foreignMutation: false }, at);
  await append(root, "aagaard.fleet-observation-refusal", value, at, env); return value;
}
function quantity(value, suffix) {
  if (typeof value !== "string" || !value.endsWith(` ${suffix}`)) return null;
  const number = Number(value.slice(0, -(suffix.length + 1))); return Number.isFinite(number) ? number : null;
}
async function sourceTick(env) {
  const documents = await queryRwilDocumentsByCategory(FLEET_TICK_CATEGORY);
  const latest = documents.map((document) => ({ id: document.id, value: document.value?.record }))
    .filter((entry) => entry.value?.ts).sort((left, right) => left.value.ts.localeCompare(right.value.ts)).at(-1);
  if (!latest) throw new Error("Aagaard has no typed fleet tick in its RWIL history");
  return { digest: latest.id, value: latest.value };
}

export function projectObservation(tick, tickDigest) {
  const accounts = (tick.accounts ?? []).map((account) => ({ account: account.account,
    liquid: { hive: quantity(account.trading?.hive, "HIVE"), hbd: quantity(account.trading?.hbd, "HBD") },
    voting: { planned: account.voting?.votesPlanned ?? 0, broadcast: account.voting?.votesBroadcast ?? 0,
      skipped: account.voting?.votesSkipped ?? 0, errors: account.voting?.execution?.errors ?? 0 },
    trading: { mode: account.trading?.mode ?? "unknown", planned: account.trading?.tradesPlanned ?? 0,
      executed: account.trading?.tradesExecuted ?? 0, liquidityPlanned: account.trading?.lpPlanned ?? 0,
      liquidityExecuted: account.trading?.lpExecuted ?? 0, savingsExecuted: account.trading?.savingsExecuted ?? false } }))
    .sort((a, b) => a.account.localeCompare(b.account));
  const sum = (field) => accounts.reduce((total, account) => total + (account.liquid[field] ?? 0), 0);
  const execution = accounts.reduce((totals, account) => ({ votesBroadcast: totals.votesBroadcast + account.voting.broadcast,
    votesSkipped: totals.votesSkipped + account.voting.skipped, voteErrors: totals.voteErrors + account.voting.errors,
    tradesExecuted: totals.tradesExecuted + account.trading.executed,
    liquidityMovesExecuted: totals.liquidityMovesExecuted + account.trading.liquidityExecuted }),
  { votesBroadcast: 0, votesSkipped: 0, voteErrors: 0, tradesExecuted: 0, liquidityMovesExecuted: 0 });
  return { type: "HiveFleetCustodyObservation", sourceTick: { id: tickDigest, settledAt: tick.ts },
    fleet: { running: tick.running === true, liveFlag: tick.live === true, enabledLanes: tick.enabled ?? [], accountCount: accounts.length },
    aggregateLiquid: { hive: Number(sum("hive").toFixed(3)), hbd: Number(sum("hbd").toFixed(3)) }, accounts, execution,
    interpretationLimits: ["Hive-and-Hive-Engine-only", "not-a-cross-chain-position", "live-flag-does-not-prove-broadcast",
      "balances-are-source-tick-observations-not-custody-title"], credentialAccess: false, chainMutation: false };
}
function solicitationProblem(activity) {
  if (activity?.["@context"] !== CONTEXT || activity.type !== "Offer" || activity.target !== ACTOR
      || activity.object?.type !== "ServiceSolicitation") return "solicitation must be an ActivityStreams Offer<ServiceSolicitation> addressed to Aagaard";
  if (activity.object.contract !== HIVE_FLEET_CUSTODY_OBSERVATION_CONTRACT) return "solicitation must name the exact normalized RMN law";
  if (activity.object.request?.scope !== "hive-wallet-fleet-custody" || typeof activity.object.request?.intendedUse !== "string"
      || activity.object.request.intendedUse.length === 0) return "request must name hive-wallet-fleet-custody and a nonempty intendedUse";
  return null;
}
async function solicit(root, activity, at, env) {
  const invalid = solicitationProblem(activity); if (invalid) return reject(root, activity, invalid, at, env);
  const source = sourceTick(env); const observation = projectObservation(source.value, source.digest);
  const terms = { type: "UnpricedServiceTerms", law: HIVE_FLEET_CUSTODY_OBSERVATION_CONTRACT,
    assetPaymentRequired: false, witInterchangeabilityClaimed: false, erasureInterchangeabilityClaimed: false, gasInterchangeabilityClaimed: false };
  const object = { type: "ExecutableServiceOffer", law: HIVE_FLEET_CUSTODY_OBSERVATION_CONTRACT,
    sourceActivity: activity.id, request: activity.object.request, requestDigest: digest(activity.object.request),
    sourceTickDigest: source.digest, observationDigest: digest(observation), terms, termsDigest: digest(terms),
    operation: "invoke-service", effects: EFFECTS };
  const offer = response("Offer", activity, object, at); await append(root, "aagaard.fleet-observation-offer", offer, at, env); return offer;
}
function invocationProblem(activity, env) {
  if (activity?.["@context"] !== CONTEXT || activity.type !== "Accept" || activity.target !== ACTOR) return "invocation must be an ActivityStreams Accept addressed to Aagaard";
  const contract = activity.object; const offer = contract?.offer;
  if (contract?.type !== "ServiceContract" || contract.law !== HIVE_FLEET_CUSTODY_OBSERVATION_CONTRACT) return "invocation must accept the exact normalized RMN law";
  if (offer?.type !== "Offer" || offer.actor !== ACTOR || offer.law !== HIVE_FLEET_CUSTODY_OBSERVATION_CONTRACT
      || !contentValid(offer) || offer.object?.type !== "ExecutableServiceOffer"
      || offer.object.law !== HIVE_FLEET_CUSTODY_OBSERVATION_CONTRACT) return "ServiceContract must carry Aagaard's exact authored offer";
  if (offer.object.requestDigest !== digest(offer.object.request) || offer.object.termsDigest !== digest(offer.object.terms)) return "accepted offer terms changed";
  if (contract.termsAcceptance?.termDigest !== offer.object.termsDigest) return "customer did not accept the exact provider terms";
  if (sourceTick(env).digest !== offer.object.sourceTickDigest) return "source fleet tick changed after the offer; solicit a fresh observation";
  const capability = contract.capability; const actions = capability?.allowedActions ?? [];
  if (capability?.type !== "Capability" || capability.holder !== ACTOR || capability.invocationTarget !== ACTOR || capability.parentOffer !== offer.id) return "invocation requires a capability held by Aagaard and bound to the offer";
  if (capability.attenuation?.sourceTickDigest !== offer.object.sourceTickDigest || capability.capTP?.target !== ACTOR || capability.capTP.method !== "invoke-service") return "capability is not attenuated to the exact tick and target";
  if (!actions.includes("invoke-service") || !EFFECTS.every((effect) => actions.includes(effect))
      || actions.some((action) => ["broadcast", "read-credentials", "move-assets", "customer-write"].includes(action))) return "capability omits provider-local evidence or grants forbidden wallet authority";
  return null;
}
async function invoke(root, activity, at, env) {
  const invalid = invocationProblem(activity, env); if (invalid) return reject(root, activity, invalid, at, env);
  const offer = activity.object.offer; const source = sourceTick(env); const started = performance.now();
  const observation = projectObservation(source.value, source.digest);
  if (digest(observation) !== offer.object.observationDigest) return reject(root, activity, "projected observation differs from the provider-authored offer", at, env);
  const resources = { type: "TypedResourceVector", computeSeconds: null,
    wallTimeSeconds: Number(((performance.now() - started) / 1000).toFixed(6)), assetAmount: null, wit: null, erasure: null, gas: null };
  const exchange = identify({ type: "HiveFleetCustodyObservationExchange", law: HIVE_FLEET_CUSTODY_OBSERVATION_CONTRACT,
    request: offer.object.request, outcome: "completion", observation, resources, recordedAt: at,
    credentialAccess: false, chainMutation: false, customerMutation: false, foreignMutation: false });
  const receipt = identify({ type: "ServicePerformanceReceipt", law: HIVE_FLEET_CUSTODY_OBSERVATION_CONTRACT,
    provider: ACTOR, customer: activity.actor, offer: offer.id, invocation: activity.id,
    fulfillment: exchange.id, outcome: exchange.outcome, recordedAt: at, assetSettlementClaimed: false });
  const result = response("Accept", activity, { type: "HiveFleetCustodyObservationResult",
    law: HIVE_FLEET_CUSTODY_OBSERVATION_CONTRACT, exchange, receipt, customerMutation: false, foreignMutation: false }, at);
  await append(root, "aagaard.fleet-observation-exchange", exchange, at, env);
  await append(root, "aagaard.fleet-observation-receipt", receipt, at, env);
  await append(root, "aagaard.fleet-observation-result", result, at, env);
  return result;
}
export async function run(activity, op = "invoke-service", at = new Date().toISOString(), env = process.env) {
  const root = dataRoot(env);
  if (op === "solicit-service") return solicit(root, activity, at, env);
  if (op === "invoke-service") return invoke(root, activity, at, env);
  return reject(root, activity, `unknown-provider-operation:${op}`, at, env);
}
if (process.argv.includes("--provider-cli") || (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
  try {
    const activity = JSON.parse(readFileSync(0, "utf8")); const output = await run(activity, operation(), instant());
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`); if (output.type === "Reject") process.exitCode = 2;
  } catch (error) { process.stderr.write(`aagaard: ${error.message}\n`); process.exitCode = 1; }
}

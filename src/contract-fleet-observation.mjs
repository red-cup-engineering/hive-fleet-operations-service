#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/computer-data-engineering-services-section/semiotic-expression-notation/semantic-content-identity";
import { claimsOf, recordClaim, FLEET_DATA_DIR } from "./core/journal.mjs";
import { ACTIVITYSTREAMS_CONTEXT } from "@red-cup-engineering/activitypub-services-section/activitystreams";

const ACTOR = "urn:ame:aagaard";
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const FLEET_TICK_CATEGORY = "aagaard.fleet-tick";
const EFFECTS = ["invoke-service", "provider-local-witness-journal-evidence"];

export function digest(value) {
  return identifyJsonSemanticContent({
    objectKind: "aagaard.hive-fleet-observation",
    value,
    witnessRoot: EMPTY_WITNESS_ROOT,
  }).token;
}

function identify(body) { return { id: digest(body), ...body }; }
function contentValid(value) { const { id: _id, ...body } = value ?? {}; return value?.id === digest(body); }
function arg(flag) { const index = process.argv.indexOf(flag); return index < 0 ? undefined : process.argv[index + 1]; }
function operation() { return arg("--operation") ?? "invoke-service"; }
function instant() { return arg("--now") ?? new Date().toISOString(); }

async function append(category, record, at) {
  return recordClaim(FLEET_DATA_DIR, category, at, record);
}

function response(type, source, object, at) {
  return identify({ "@context": ACTIVITYSTREAMS_CONTEXT, type, actor: ACTOR, target: source?.actor ?? null,
    inReplyTo: source?.id ?? null, object, published: at });
}

async function reject(source, reason, at, env) {
  const value = response("Reject", source, { type: "HiveFleetCustodyObservationRefusal", reason,
    prohibitedEffectsPerformed: false, credentialAccess: false, chainMutation: false,
    customerMutation: false, foreignMutation: false }, at);
  await append("aagaard.fleet-observation-refusal", value, at, env);
  return value;
}

function quantity(value, suffix) {
  if (typeof value !== "string" || !value.endsWith(` ${suffix}`)) return null;
  const number = Number(value.slice(0, -(suffix.length + 1)));
  return Number.isFinite(number) ? number : null;
}

async function sourceTick(env) {
  const records = claimsOf(FLEET_DATA_DIR, FLEET_TICK_CATEGORY);
  const latest = records.filter((record) => record?.ts)
    .sort((left, right) => left.ts.localeCompare(right.ts)).at(-1);
  if (!latest) throw new Error("Aagaard has no typed fleet tick in its journal");
  return { digest: digest(latest), value: latest };
}

export function projectObservation(tick, tickDigest) {
  const accounts = (tick.accounts ?? []).map((account) => ({
    account: account.account,
    liquid: { hive: quantity(account.trading?.hive, "HIVE"), hbd: quantity(account.trading?.hbd, "HBD") },
    voting: { planned: account.voting?.votesPlanned ?? 0, broadcast: account.voting?.votesBroadcast ?? 0,
      skipped: account.voting?.votesSkipped ?? 0, errors: account.voting?.execution?.errors ?? 0 },
    trading: { mode: account.trading?.mode ?? "unknown", planned: account.trading?.tradesPlanned ?? 0,
      executed: account.trading?.tradesExecuted ?? 0, liquidityPlanned: account.trading?.lpPlanned ?? 0,
      liquidityExecuted: account.trading?.lpExecuted ?? 0, savingsExecuted: account.trading?.savingsExecuted ?? false },
  })).sort((left, right) => left.account.localeCompare(right.account));
  const sum = (field) => accounts.reduce((total, account) => total + (account.liquid[field] ?? 0), 0);
  const execution = accounts.reduce((totals, account) => ({
    votesBroadcast: totals.votesBroadcast + account.voting.broadcast,
    votesSkipped: totals.votesSkipped + account.voting.skipped,
    voteErrors: totals.voteErrors + account.voting.errors,
    tradesExecuted: totals.tradesExecuted + account.trading.executed,
    liquidityMovesExecuted: totals.liquidityMovesExecuted + account.trading.liquidityExecuted,
  }), { votesBroadcast: 0, votesSkipped: 0, voteErrors: 0, tradesExecuted: 0, liquidityMovesExecuted: 0 });
  return { type: "HiveFleetCustodyObservation", sourceTick: { id: tickDigest, settledAt: tick.ts },
    fleet: { running: tick.running === true, liveFlag: tick.live === true,
      enabledLanes: tick.enabled ?? [], accountCount: accounts.length },
    aggregateLiquid: { hive: Number(sum("hive").toFixed(3)), hbd: Number(sum("hbd").toFixed(3)) },
    accounts, execution,
    interpretationLimits: ["Hive-and-Hive-Engine-only", "not-a-cross-chain-position",
      "live-flag-does-not-prove-broadcast", "balances-are-source-tick-observations-not-custody-title"],
    credentialAccess: false, chainMutation: false };
}

function solicitationProblem(activity) {
  if (activity?.["@context"] !== ACTIVITYSTREAMS_CONTEXT || activity.type !== "Offer" || activity.target !== ACTOR
      || activity.object?.type !== "ServiceSolicitation") {
    return "solicitation must be an ActivityStreams Offer<ServiceSolicitation> addressed to Aagaard";
  }
  if (activity.object.request?.scope !== "hive-wallet-fleet-custody"
      || typeof activity.object.request?.intendedUse !== "string" || activity.object.request.intendedUse.length === 0) {
    return "request must name hive-wallet-fleet-custody and a nonempty intendedUse";
  }
  return null;
}

async function solicit(activity, at, env) {
  const invalid = solicitationProblem(activity);
  if (invalid) return reject(activity, invalid, at, env);
  const source = await sourceTick(env);
  const observation = projectObservation(source.value, source.digest);
  const terms = { type: "UnpricedServiceTerms", assetPaymentRequired: false,
    credentialAccessGranted: false, transactionAuthorityGranted: false };
  const object = { type: "ExecutableServiceOffer", sourceActivity: activity.id,
    request: activity.object.request, requestDigest: digest(activity.object.request),
    sourceTickDigest: source.digest, observationDigest: digest(observation),
    terms, termsDigest: digest(terms), operation: "invoke-service", effects: EFFECTS };
  const offer = response("Offer", activity, object, at);
  await append("aagaard.fleet-observation-offer", offer, at, env);
  return offer;
}

async function invocationProblem(activity, env) {
  if (activity?.["@context"] !== ACTIVITYSTREAMS_CONTEXT || activity.type !== "Accept" || activity.target !== ACTOR) {
    return "invocation must be an ActivityStreams Accept addressed to Aagaard";
  }
  const contract = activity.object;
  const offer = contract?.offer;
  if (contract?.type !== "ServiceContract" || offer?.type !== "Offer" || offer.actor !== ACTOR
      || !contentValid(offer) || offer.object?.type !== "ExecutableServiceOffer") {
    return "ServiceContract must carry Aagaard's exact authored offer";
  }
  if (offer.object.requestDigest !== digest(offer.object.request)
      || offer.object.termsDigest !== digest(offer.object.terms)
      || contract.termsAcceptance?.termDigest !== offer.object.termsDigest) return "accepted offer terms changed";
  const current = await sourceTick(env);
  if (current.digest !== offer.object.sourceTickDigest) return "source fleet tick changed after the offer; solicit a fresh observation";
  const capability = contract.capability;
  const actions = capability?.allowedActions ?? [];
  if (capability?.type !== "Capability" || capability.holder !== ACTOR || capability.invocationTarget !== ACTOR
      || capability.parentOffer !== offer.id) return "invocation requires a capability held by Aagaard and bound to the offer";
  if (capability.attenuation?.sourceTickDigest !== offer.object.sourceTickDigest
      || capability.capTP?.target !== ACTOR || capability.capTP.method !== "invoke-service") {
    return "capability is not attenuated to the exact tick and target";
  }
  if (!EFFECTS.every((effect) => actions.includes(effect))
      || actions.some((action) => ["broadcast", "read-credentials", "move-assets", "customer-write"].includes(action))) {
    return "capability omits provider-local evidence or grants forbidden wallet authority";
  }
  return null;
}

async function invoke(activity, at, env) {
  const invalid = await invocationProblem(activity, env);
  if (invalid) return reject(activity, invalid, at, env);
  const offer = activity.object.offer;
  const source = await sourceTick(env);
  const started = performance.now();
  const observation = projectObservation(source.value, source.digest);
  if (digest(observation) !== offer.object.observationDigest) {
    return reject(activity, "projected observation differs from the provider-authored offer", at, env);
  }
  const exchange = identify({ type: "HiveFleetCustodyObservationExchange", request: offer.object.request,
    outcome: "completion", observation,
    resources: { type: "TypedResourceVector", computeSeconds: null,
      wallTimeSeconds: Number(((performance.now() - started) / 1000).toFixed(6)),
      assetAmount: null, wit: null, erasure: null, gas: null },
    recordedAt: at, credentialAccess: false, chainMutation: false, customerMutation: false, foreignMutation: false });
  const receipt = identify({ type: "ServicePerformanceReceipt", provider: ACTOR, customer: activity.actor,
    offer: offer.id, invocation: activity.id, fulfillment: exchange.id, outcome: exchange.outcome,
    recordedAt: at, assetSettlementClaimed: false });
  const result = response("Accept", activity,
    { type: "HiveFleetCustodyObservationResult", exchange, receipt, customerMutation: false, foreignMutation: false }, at);
  await append("aagaard.fleet-observation-exchange", exchange, at, env);
  await append("aagaard.fleet-observation-receipt", receipt, at, env);
  await append("aagaard.fleet-observation-result", result, at, env);
  return result;
}

export async function run(activity, op = "invoke-service", at = new Date().toISOString(), env = process.env) {
  if (op === "solicit-service") return solicit(activity, at, env);
  if (op === "invoke-service") return invoke(activity, at, env);
  return reject(activity, `unknown-provider-operation:${op}`, at, env);
}

if (process.argv.includes("--provider-cli") || (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
  try {
    const activity = JSON.parse(readFileSync(0, "utf8"));
    const output = await run(activity, operation(), instant());
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    if (output.type === "Reject") process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${basename(process.argv[1])}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

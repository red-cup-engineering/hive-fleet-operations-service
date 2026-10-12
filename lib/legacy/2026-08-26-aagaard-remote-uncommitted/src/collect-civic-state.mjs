import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readLocalRwilDocumentsByCategory } from "@emsenn/rwil-rdf-services/client";

import { projectObservation } from "./contract-fleet-observation.mjs";

const NODE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REPORTING_ACTOR = "urn:ame:turntide-islands:state-of-harmonious-union-reporting-service";
const CONSTITUENT_CLAIM_LAW = "ni:///sha-256;gOwzNjnx7ecoz4YYyYQAOBNT-BoXGyDcY2m1RcIOhe4";
export const AAGAARD_STATE_ACTOR = "urn:ame:aagaard:civic-state-report";
export const AAGAARD_SETTLEMENT = "urn:ame:aagaard";

function decimal(value, places = 0) { return Number(value ?? 0).toFixed(places); }
function measurement({ claimId, label, amount, unit, displayOrder, domain, summary, provenance, economic }) {
  return { claimId, status: "present", value: summary, measurement: { label, amount, unit, displayOrder, domain }, provenance: [provenance], evidence: [provenance], ...(economic ? { economic } : {}) };
}

export function collectAagaardCivicState({ period, recordedAt, root = NODE_ROOT }) {
  const document = readLocalRwilDocumentsByCategory(join(root, "data"), "aagaard.fleet-tick").filter((entry) => entry.value?.record?.ts).sort((left, right) => left.value.record.ts.localeCompare(right.value.record.ts)).at(-1);
  if (!document) throw new Error("Aagaard has no typed fleet tick in RWIL");
  const tick = document.value.record; const provenance = document.id;
  const observation = projectObservation(tick, document.id); const accounts = observation.accounts;
  const sum = (selector) => accounts.reduce((total, account) => total + Number(selector(account) ?? 0), 0);
  const hive = decimal(observation.aggregateLiquid.hive, 3); const hbd = decimal(observation.aggregateLiquid.hbd, 3);
  const ageSeconds = Math.max(0, Math.floor((Date.parse(recordedAt) - Date.parse(observation.sourceTick.settledAt)) / 1000));
  const limits = observation.interpretationLimits.join("; ");
  const claims = [
    measurement({ claimId: "economy/liquid-hive-observed", label: "Liquid HIVE", amount: hive, unit: "HIVE", displayOrder: 10, domain: "economy", summary: `${hive} HIVE observed across ${accounts.length} fleet accounts. Limits: ${limits}`, provenance, economic: { amount: hive, currencyOrUnit: "HIVE", period, basis: "Aagaard exact source-tick fleet observation; not custody title" } }),
    measurement({ claimId: "economy/liquid-hbd-observed", label: "Liquid HBD", amount: hbd, unit: "HBD", displayOrder: 20, domain: "economy", summary: `${hbd} HBD observed across ${accounts.length} fleet accounts. Limits: ${limits}`, provenance, economic: { amount: hbd, currencyOrUnit: "HBD", period, basis: "Aagaard exact source-tick fleet observation; not custody title" } }),
    measurement({ claimId: "economy/fleet-accounts-observed", label: "Fleet accounts", amount: String(accounts.length), unit: "accounts", displayOrder: 30, domain: "economy", summary: `${accounts.length} Hive fleet accounts observed.`, provenance }),
    measurement({ claimId: "economy/trades-planned", label: "Trades planned", amount: String(sum((account) => account.trading.planned)), unit: "actions", displayOrder: 40, domain: "economy", summary: "Proposed trades in the exact source tick; proposal is not execution.", provenance }),
    measurement({ claimId: "economy/trades-executed", label: "Trades executed", amount: String(observation.execution.tradesExecuted), unit: "actions", displayOrder: 50, domain: "economy", summary: "Trades executed in the exact source tick.", provenance }),
    measurement({ claimId: "economy/liquidity-moves-planned", label: "Liquidity planned", amount: String(sum((account) => account.trading.liquidityPlanned)), unit: "actions", displayOrder: 60, domain: "economy", summary: "Proposed liquidity moves in the exact source tick; proposal is not execution.", provenance }),
    measurement({ claimId: "economy/liquidity-moves-executed", label: "Liquidity executed", amount: String(observation.execution.liquidityMovesExecuted), unit: "actions", displayOrder: 70, domain: "economy", summary: "Liquidity moves executed in the exact source tick.", provenance }),
    measurement({ claimId: "politics/hive-votes-planned", label: "Votes planned", amount: String(sum((account) => account.voting.planned)), unit: "votes", displayOrder: 80, domain: "politics", summary: "Hive governance/content votes planned in the exact source tick.", provenance }),
    measurement({ claimId: "politics/hive-votes-broadcast", label: "Votes broadcast", amount: String(observation.execution.votesBroadcast), unit: "votes", displayOrder: 90, domain: "politics", summary: "Hive governance/content votes actually broadcast in the exact source tick.", provenance }),
    measurement({ claimId: "civic/source-observation-age", label: "Fleet data age", amount: String(ageSeconds), unit: "seconds", displayOrder: 100, domain: "civic", summary: `Source fleet tick settled at ${observation.sourceTick.settledAt}.`, provenance }),
  ];
  return { type: "Accept", actor: AAGAARD_STATE_ACTOR, target: REPORTING_ACTOR, object: { type: "ConstituentStateEnvelope", law: CONSTITUENT_CLAIM_LAW, settlementActor: AAGAARD_SETTLEMENT, period, recordedAt, claims } };
}

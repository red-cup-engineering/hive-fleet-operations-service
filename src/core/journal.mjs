/**
 * Aagaard's journal: the one record type, `aagaard-claim`, of the store under a fleet data
 * directory. What Aagaard itself knows (its observations, predictions,
 * experiments, strategy readings, drafts and scoreboard) is recorded here as
 * charged claims; what the chain already holds is only witnessed here, as an
 * evidence row naming the transaction, and its history is read from the chain.
 */
import { fileURLToPath } from "node:url";
import { each, put } from "@red-cup-engineering/semiotic-eavt-services-section/store";

const CLAIM_TYPE = "aagaard-claim";

/** The fleet's data directory: the package root's data/, where the running fleet keeps its journal. */
export const FLEET_DATA_DIR = fileURLToPath(new URL("../../data", import.meta.url));
const SUPPORTED = Object.freeze({ for: true, against: false });

function requiredDataDir(dataDir) {
  if (typeof dataDir !== "string" || dataDir === "") throw new TypeError("Aagaard's journal requires its data directory");
  return dataDir;
}

/** Record one of Aagaard's own claims under a category. */
export function recordClaim(dataDir, category, recordedAt, record, told = SUPPORTED) {
  const charged = told.for === SUPPORTED.for && told.against === SUPPORTED.against ? {} : { told };
  return { id: put(requiredDataDir(dataDir), CLAIM_TYPE, { category, at: new Date(recordedAt).toISOString(), claim: record, ...charged }) };
}

/** Aagaard's claims under a category, oldest first. */
export function claimsOf(dataDir, category) {
  return [...each(requiredDataDir(dataDir), CLAIM_TYPE)]
    .filter(({ record }) => record.category === category)
    .sort((left, right) => String(left.record.at).localeCompare(String(right.record.at)) || left.address.localeCompare(right.address))
    .map(({ record }) => record.claim);
}

const EVIDENCE_FIELDS = ["eventId", "kind", "account", "transactionId", "txId", "trxId", "blockNum", "status", "symbol", "quantity", "amount"];

/** Witness one chain act: the claim that it happened and the transaction that evidences it. */
export function witnessChainAct(dataDir, category, recordedAt, event) {
  const evidence = Object.fromEntries(EVIDENCE_FIELDS.filter((field) => event?.[field] !== undefined && event[field] !== null).map((field) => [field, event[field]]));
  recordClaim(dataDir, category, recordedAt, evidence);
  return event;
}

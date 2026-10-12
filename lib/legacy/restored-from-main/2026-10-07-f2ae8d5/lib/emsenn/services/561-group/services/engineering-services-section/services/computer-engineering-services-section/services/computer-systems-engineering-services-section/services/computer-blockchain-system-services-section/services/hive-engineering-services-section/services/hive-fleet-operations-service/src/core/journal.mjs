/**
 * Aagaard's journal: the one semantic record journal under a fleet data
 * directory. What Aagaard itself knows (its observations, predictions,
 * experiments, strategy readings, drafts and scoreboard) is recorded here as
 * charged claims. Chain witnesses retain the complete admitted settlement event:
 * the chain supplies transaction history, but cannot reconstruct provider receipts,
 * observations, policy decisions or exact accounting quantities.
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createSemanticRecordJournal } from "@red-cup-engineering/semiotic-eavt-services-section/record-semantic-record";

const OBJECT_KIND = "aagaard.record";

/** The fleet's data directory: the package root's data/, where the running fleet keeps its journal. */
export const FLEET_DATA_DIR = process.env.AAGAARD_DATA_DIR
  ? resolve(process.env.AAGAARD_DATA_DIR)
  : fileURLToPath(new URL("../../data", import.meta.url));
const SUPPORTED = Object.freeze({ for: true, against: false });
const journals = new Map();

function journalOf(dataDir) {
  if (typeof dataDir !== "string" || dataDir === "") throw new TypeError("Aagaard's journal requires its data directory");
  if (!journals.has(dataDir)) journals.set(dataDir, createSemanticRecordJournal({ root: dataDir, objectKind: OBJECT_KIND }));
  return journals.get(dataDir);
}

/** Record one of Aagaard's own claims under a category. */
export function recordClaim(dataDir, category, recordedAt, record, told = SUPPORTED) {
  return journalOf(dataDir).record({ category, recordedAt: new Date(recordedAt).toISOString(), record, told });
}

/** Aagaard's claims under a category, oldest first. */
export function claimsOf(dataDir, category) {
  return [...journalOf(dataDir).query({ category })]
    .sort((left, right) => String(left.recordedAt).localeCompare(String(right.recordedAt)))
    .map(({ record }) => record);
}

/** Witness an admitted chain settlement without discarding its off-chain evidence.
 * Recording the event makes a claim; it grants no signing or retry authority. */
export function witnessChainAct(dataDir, category, recordedAt, event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new TypeError("A chain witness requires a settlement event object");
  }
  recordClaim(dataDir, category, recordedAt, event);
  return event;
}

/** Read held testimony without treating contested records as settled knowledge. */
export function heldClaimsOf(dataDir, category, matches = () => true) {
  const rows = journalOf(dataDir).query({ category }).filter(row => matches(row.record));
  const groups = new Map();
  for (const row of rows) { const group = groups.get(row.id) ?? []; group.push(row); groups.set(row.id, group); }
  return [...groups.values()].map(group => {
    if (group.some(row => row.told?.against)) throw new Error("Settlement witness has contrary testimony; reconciliation is required");
    if (!group.some(row => row.told?.for)) return undefined;
    return group[0];
  }).filter(Boolean).sort((a,b) => String(a.recordedAt).localeCompare(String(b.recordedAt))).map(row => row.record);
}

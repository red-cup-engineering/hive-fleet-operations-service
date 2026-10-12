import { recordClaim, FLEET_DATA_DIR } from "./core/journal.mjs";

const ACTOR = "urn:ame:aagaard";
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
export const OPPORTUNITY_FEED_CATEGORY = "aagaard.opportunity-feed";

const MAX_JSON_DEPTH = 100;
const MAX_ERROR_PATH_LENGTH = 320;

function boundedPath(path) {
  if (path.length <= MAX_ERROR_PATH_LENGTH) return path;
  return `${path.slice(0, 150)}...${path.slice(-150)}`;
}

function refuseJsonValue(path, reason) {
  throw new TypeError(`Aagaard opportunity-feed JSON value refused at ${boundedPath(path)}: ${reason}`);
}

function projectJsonValue(value, path, depth, active) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) refuseJsonValue(path, "number must be finite");
    return value;
  }
  if (value === undefined) refuseJsonValue(path, "undefined is not a JSON value");
  if (typeof value === "bigint") refuseJsonValue(path, "bigint is not a JSON value");
  if (typeof value === "symbol") refuseJsonValue(path, "symbol is not a JSON value");
  if (typeof value === "function") refuseJsonValue(path, "function is not a JSON value");
  if (depth >= MAX_JSON_DEPTH) refuseJsonValue(path, `nesting exceeds ${MAX_JSON_DEPTH} levels`);
  if (active.has(value)) refuseJsonValue(path, "cyclic reference is not a JSON value");

  active.add(value);
  try {
    if (Array.isArray(value)) {
      const projected = [];
      for (let index = 0; index < value.length; index += 1) {
        const itemPath = `${path}[${index}]`;
        if (!Object.hasOwn(value, index)) refuseJsonValue(itemPath, "array hole is not a JSON value");
        if (value[index] === undefined) refuseJsonValue(itemPath, "undefined array entry is not a JSON value");
        projected.push(projectJsonValue(value[index], itemPath, depth + 1, active));
      }
      return Object.freeze(projected);
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      refuseJsonValue(path, "non-plain object is not a JSON value");
    }
    const projected = {};
    for (const key of Object.keys(value)) {
      const propertyPath = `${path}[${JSON.stringify(key)}]`;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) refuseJsonValue(propertyPath, "accessor property is not a JSON value");
      if (descriptor.value === undefined) continue;
      Object.defineProperty(projected, key, {
        value: projectJsonValue(descriptor.value, propertyPath, depth + 1, active),
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(projected);
  } finally {
    active.delete(value);
  }
}

export function projectOpportunityFeedJsonValue(value) {
  return projectJsonValue(value, "$", 0, new WeakSet());
}

function sourceUnknown(source, problem) {
  return Object.freeze({ source, status: "unknown", problem });
}

async function bounded(source, provider) {
  try {
    const value = await provider();
    if (value?.credentialAccess !== false || value?.chainMutation !== false) {
      return sourceUnknown(source, "provider did not prove credentialAccess:false and chainMutation:false");
    }
    return Object.freeze({ source, status: "observed", value });
  } catch (error) {
    return sourceUnknown(source, error instanceof Error ? error.message : String(error));
  }
}

function defaultUnpricedResourceCost() {
  return Object.freeze({
    status: "unpriced-resource-cost-model",
    pricedBySource: Object.freeze(["pool-fee", "slippage-buffer", "complete-bid-book-depth"]),
    stillUnpriced: Object.freeze(["hive-resource-credits", "signer", "runner-or-paymaster"]),
  });
}

function globalCandidates(observation, resourceCostObservation) {
  if (observation.status !== "observed") return [];
  const scan = observation.value;
  // Resource cost (Hive RC as a capacity floor, signer, and runner) is
  // checked/priced once per feed cycle -- see resourceCostModel.mjs's
  // priceResourceCosts -- and relayed onto every qualifying candidate.
  // With no resourceCost provider supplied, the feed states plainly that
  // the model is unpriced rather than fabricating a number.
  const resourceCost = resourceCostObservation?.status === "observed" ? resourceCostObservation.value : defaultUnpricedResourceCost();
  return (scan.opportunities ?? []).filter((candidate) => candidate.policyAdmitted === true).map((candidate) => Object.freeze({
    source: "global-arbitrage-scan",
    opportunityClass: "swap-hive-profit",
    identity: candidate.pool,
    admittedBySourcePolicy: true,
    executionAdmissible: false,
    worstCaseProfitSwapHive: candidate.exact?.admitted ? candidate.exact.quote.worstCaseProfitSwapHive : null,
    resourceCost,
    providers: scan.certifyingProviders ?? [],
    provenance: scan.providerKnowledge ?? null,
    sourceCandidate: candidate,
  }));
}

function gameCandidates(observation) {
  if (observation.status !== "observed") return [];
  const games = observation.value;
  return (games.ranked ?? []).map((candidate) => {
    const detail = candidate.game === "dcity" ? games.observations?.dcity?.plan ?? null
      : candidate.game === "holozing-rewards" ? games.observations?.holozingRewards?.plan ?? null
      : candidate.game === "terracore" ? games.observations?.terracore?.plan ?? null
      : null;
    return Object.freeze({
      source: "game-opportunity-cycle",
      opportunityClass: candidate.benefitClass,
      identity: `${candidate.game}:${candidate.action}`,
      admittedBySourcePolicy: candidate.admittedNow === true,
      executionAdmissible: false,
      resourceCost: Object.freeze({ status: candidate.rcDecision }),
      refusal: candidate.refusal ?? null,
      evidence: candidate.evidence,
      provenance: candidate.evidenceSummary,
      plan: detail,
      sourceCandidate: candidate,
    });
  });
}

function refusals(observations) {
  const output = [];
  const global = observations.globalArbitrage;
  if (global.status === "observed") {
    for (const candidate of global.value.opportunities ?? []) {
      if (candidate.policyAdmitted !== true) output.push(Object.freeze({ source: global.source,
        identity: candidate.pool, reason: candidate.policyRefusal ?? "source-policy-refused", evidence: candidate }));
    }
    if (global.value.refusal) output.push(Object.freeze({ source: global.source, identity: "scan", reason: global.value.refusal,
      evidence: global.value.providerKnowledge ?? null }));
  }
  const pool = observations.poolCycle;
  if (pool.status === "observed" && pool.value.decision === "refuse") output.push(Object.freeze({ source: pool.source,
    identity: (pool.value.route ?? []).join("->"), reason: pool.value.refusal ?? "source-policy-refused", evidence: pool.value.assay ?? null }));
  const games = observations.games;
  if (games.status === "observed") {
    for (const candidate of games.value.ranked ?? []) {
      if (candidate.refusal) output.push(Object.freeze({ source: games.source, identity: `${candidate.game}:${candidate.action}`,
        reason: candidate.refusal, evidence: candidate }));
    }
  }
  return output;
}

function unknowns(observations) {
  const output = Object.values(observations).filter((observation) => observation.status === "unknown");
  const global = observations.globalArbitrage;
  if (global.status === "observed") for (const unavailable of global.value.providerKnowledge?.unavailable ?? []) {
    output.push(Object.freeze({ source: global.source, status: "unknown", provider: unavailable.provider, problem: unavailable.problem }));
  }
  const pool = observations.poolCycle;
  if (pool.status === "observed") for (const unavailable of pool.value.assay?.providerKnowledge?.unavailable ?? []) {
    output.push(Object.freeze({ source: pool.source, status: "unknown", provider: unavailable.provider, problem: unavailable.problem }));
  }
  const games = observations.games;
  if (games.status === "observed") for (const unavailable of games.value.observations?.unavailable ?? []) {
    output.push(Object.freeze({ source: games.source, status: "unknown", provider: unavailable.game, problem: unavailable.error }));
  }
  if (games.status === "observed" && games.value.observations?.terracore?.plan?.kind === "claim"
    && games.value.observations?.terracoreExit == null) {
    output.push(Object.freeze({ source: games.source, status: "unknown", provider: "terracore-exit",
      problem: "claim exit-value observation unavailable" }));
  }
  return output;
}

export function formOpportunityFeed({ observedAt, globalArbitrage, poolCycle, games, resourceCost = null }) {
  const at = new Date(observedAt).toISOString();
  const observations = resourceCost
    ? Object.freeze({ globalArbitrage, poolCycle, games, resourceCost })
    : Object.freeze({ globalArbitrage, poolCycle, games });
  const candidates = Object.freeze([...globalCandidates(globalArbitrage, resourceCost), ...gameCandidates(games)]);
  return projectOpportunityFeedJsonValue({
    kind: "aagaard.unified-opportunity-feed",
    version: 1,
    observedAt: at,
    authority: Object.freeze({ credentialAccess: false, chainMutation: false, signing: false, broadcasting: false, execution: false }),
    ordering: Object.freeze({ mode: "source-policy-only", noScalarization: true,
      statement: "SWAP.HIVE profit, treasury protection, productive state, learning, credentials, and resource costs remain separate benefit classes." }),
    candidates,
    refusals: Object.freeze(refusals(observations)),
    unknowns: Object.freeze(unknowns(observations)),
    evidence: observations,
  });
}

const journalWriter = ({ category, recordedAt, record }) => recordClaim(FLEET_DATA_DIR, category, recordedAt, record);

export async function recordOpportunityFeed(feed, { writer = journalWriter } = {}) {
  return writer({ category: OPPORTUNITY_FEED_CATEGORY, recordedAt: feed.observedAt, record: feed });
}

export async function observeOpportunityFeed({ providers, now = () => new Date().toISOString(), writer = journalWriter } = {}) {
  if (!providers || typeof providers.globalArbitrage !== "function" || typeof providers.poolCycle !== "function" || typeof providers.games !== "function") {
    throw new TypeError("opportunity feed requires globalArbitrage, poolCycle, and games providers");
  }
  const observedAt = new Date(now()).toISOString();
  const [globalArbitrage, poolCycle, games, resourceCost] = await Promise.all([
    bounded("global-arbitrage-scan", providers.globalArbitrage),
    bounded("exact-pool-cycle-assay", providers.poolCycle),
    bounded("game-opportunity-cycle", providers.games),
    typeof providers.resourceCost === "function" ? bounded("resource-cost-model", providers.resourceCost) : Promise.resolve(null),
  ]);
  const feed = formOpportunityFeed({ observedAt, globalArbitrage, poolCycle, games, resourceCost });
  const journal = await recordOpportunityFeed(feed, { writer });
  return Object.freeze({ feed, journal });
}

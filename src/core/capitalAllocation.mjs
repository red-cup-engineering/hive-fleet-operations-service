import { canonicalJson } from "@red-cup-engineering/json-services-section/canonical-json";
import { semanticId } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";
import { isNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";

export const CAPITAL_REQUEST_SCHEMA = "agrodao.hive-capital-allocation-request.v1";
export const CAPITAL_DECISION_SCHEMA = "agrodao.hive-capital-allocation-decision.v1";
export const TREASURY_STEWARD = "urn:office:agrodao:treasury-steward";
export const SIGMUND_ENTERPRISE = "urn:ame:sigmund-hive-arbitrage-enterprise";
export const HELP_ENTERPRISE = "urn:ame:help-hive-liquidity-enterprise";
export const AAGAARD_ENTERPRISE = "urn:ame:aagaard";
export const PROTECTED_ASSET_IDS = Object.freeze(new Set(["holozing-alpha-vial"]));

const MAX_EVIDENCE_AGE_MS = 30_000;
const MAX_AUTHORIZATION_LIFETIME_MS = 5 * 60_000;
const URN_OR_NI = /^(?:urn:|ni:\/\/\/sha-256;)/u;

export class HiveCapitalAllocationRefusal extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HiveCapitalAllocationRefusal";
    this.code = code;
  }
}

function refuse(code, message) {
  throw new HiveCapitalAllocationRefusal(code, message);
}



function exactObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) refuse("malformed-request", `${label} must be an object`);
  return value;
}

function exactArray(value, label) {
  if (!Array.isArray(value)) refuse("malformed-request", `${label} must be an array`);
  return value;
}

function exactString(value, label) {
  if (typeof value !== "string" || value.length === 0) refuse("malformed-request", `${label} must be a non-empty string`);
  return value;
}

function units(value, label) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    refuse("malformed-units", `${label} must be a canonical non-negative integer string`);
  }
  return BigInt(value);
}

function instant(value, label) {
  const text = exactString(value, label);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== text) refuse("malformed-time", `${label} must be a canonical ISO instant`);
  return parsed;
}

function evidenceId(value, label) {
  const text = exactString(value, label);
  if (!URN_OR_NI.test(text)) refuse("unbound-evidence", `${label} must be a URN or SHA-256 ni identifier`);
  return text;
}

function planDigest(value, label) {
  const text = exactString(value, label);
  if (!isNiUri(text)) refuse("unbound-plan", `${label} must be the content address of a plan`);
  return text;
}

function isProtectedAsset(line) {
  return PROTECTED_ASSET_IDS.has(line.assetId)
    || /^alpha[._ -]?vial$/iu.test(line.symbol)
    || line.protected === true;
}

function indexUnique(lines, label) {
  const result = new Map();
  for (const [index, raw] of exactArray(lines, label).entries()) {
    const line = exactObject(raw, `${label}[${index}]`);
    const assetId = exactString(line.assetId, `${label}[${index}].assetId`);
    if (result.has(assetId)) refuse("duplicate-asset", `${label} repeats asset '${assetId}'`);
    result.set(assetId, line);
  }
  return result;
}

function authorization({ issuer, account, lane, actions, decisionId, observationId, plan, validFrom, expiresAt, releaseId }) {
  return Object.freeze({
    kind: "agrodao.hive-enterprise-execution-authorization.v1",
    issuer,
    consumer: AAGAARD_ENTERPRISE,
    account,
    lane,
    actions: Object.freeze([...actions]),
    decisionId,
    observationId,
    planDigest: plan,
    validFrom,
    expiresAt,
    ...(releaseId ? { releaseId } : {}),
  });
}

/**
 * Admit one bounded Hive capital decision. This is treasury law, not a chain
 * executor: it emits exact cross-enterprise authorizations and never signs,
 * assembles, or broadcasts a transaction.
 */
export function admitHiveCapitalAllocation(input, now = new Date()) {
  const request = exactObject(input, "request");
  if (request.schema !== CAPITAL_REQUEST_SCHEMA) refuse("wrong-schema", `expected ${CAPITAL_REQUEST_SCHEMA}`);
  if (request.requestedBy !== TREASURY_STEWARD) {
    refuse("wrong-authority", "only AGRODAO's treasury-steward may request a capital admission; CEO and Aagaard direct allocation are refused");
  }

  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(nowMs)) refuse("malformed-time", "now must be a valid Date");
  const observedAtMs = instant(request.observedAt, "observedAt");
  const expiresAtMs = instant(request.expiresAt, "expiresAt");
  if (observedAtMs > nowMs || nowMs - observedAtMs > MAX_EVIDENCE_AGE_MS) {
    refuse("stale-inventory", "inventory evidence is future-dated or older than 30 seconds");
  }
  if (expiresAtMs <= nowMs || expiresAtMs - observedAtMs > MAX_AUTHORIZATION_LIFETIME_MS) {
    refuse("invalid-expiry", "capital authorization must be live and may last at most five minutes from observation");
  }
  const observationId = evidenceId(request.observationId, "observationId");

  const inventory = indexUnique(request.inventory, "inventory");
  const reserve = indexUnique(exactObject(request.arbitrage, "arbitrage").reserve, "arbitrage.reserve");
  const uses = indexUnique(exactObject(request.liquidity, "liquidity").uses, "liquidity.uses");
  const minimumLiquid = indexUnique(request.liquidity.minimumLiquid, "liquidity.minimumLiquid");
  const arbitrage = request.arbitrage;
  const liquidity = request.liquidity;

  if (arbitrage.enterprise !== SIGMUND_ENTERPRISE) {
    refuse("wrong-arbitrage-enterprise", "arbitrage capital must be requested by the Sigmund enterprise");
  }
  const arbitrageAccount = exactString(arbitrage.account, "arbitrage.account");
  if (liquidity.enterprise !== HELP_ENTERPRISE || liquidity.account !== "help-fund") {
    refuse("wrong-liquidity-enterprise", "pool capital belongs to the HELP enterprise and help-fund account");
  }
  const arbitragePlan = planDigest(arbitrage.planDigest, "arbitrage.planDigest");
  const liquidityPlan = planDigest(liquidity.planDigest, "liquidity.planDigest");

  for (const assetId of reserve.keys()) if (!inventory.has(assetId)) refuse("unknown-asset", `arbitrage reserve names absent asset '${assetId}'`);
  for (const assetId of uses.keys()) if (!inventory.has(assetId)) refuse("unknown-asset", `liquidity use names absent asset '${assetId}'`);
  for (const assetId of minimumLiquid.keys()) if (!inventory.has(assetId)) refuse("unknown-asset", `HELP minimum-liquid reserve names absent asset '${assetId}'`);

  const allocations = [];
  const releaseLines = [];
  const liquidityLines = [];
  for (const [assetId, raw] of [...inventory.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const line = exactObject(raw, `inventory.${assetId}`);
    const symbol = exactString(line.symbol, `inventory.${assetId}.symbol`);
    const custodyAccount = exactString(line.custodyAccount, `inventory.${assetId}.custodyAccount`);
    const available = units(line.units, `inventory.${assetId}.units`);
    const precision = Number(line.precision);
    if (!Number.isInteger(precision) || precision < 0 || precision > 18) refuse("malformed-precision", `inventory.${assetId}.precision must be an integer from 0 through 18`);
    const protectedAsset = isProtectedAsset({ assetId, symbol, protected: line.protected });
    const reserved = reserve.has(assetId) ? units(reserve.get(assetId).units, `arbitrage.reserve.${assetId}.units`) : 0n;
    const helpUse = uses.has(assetId) ? units(uses.get(assetId).units, `liquidity.uses.${assetId}.units`) : 0n;
    const helpMinimum = minimumLiquid.has(assetId) ? units(minimumLiquid.get(assetId).units, `liquidity.minimumLiquid.${assetId}.units`) : 0n;

    if (protectedAsset && (reserved !== 0n || helpUse !== 0n)) {
      refuse("protected-asset", `protected asset '${assetId}' cannot be reserved for trading or released to liquidity`);
    }
    if (reserved > available) refuse("underfunded-arbitrage", `Sigmund reserve for '${assetId}' exceeds current available units`);
    const released = protectedAsset ? 0n : available - reserved;
    if (helpUse > 0n && !minimumLiquid.has(assetId)) {
      refuse("missing-help-reserve", `HELP liquidity use for '${assetId}' has no exact merchant and recall reserve`);
    }
    if (helpMinimum > released || helpUse > released - helpMinimum) {
      refuse("release-exceeded", `HELP liquidity use and operational reserve for '${assetId}' exceed Sigmund's released surplus`);
    }
    if (helpUse > 0n && custodyAccount !== "help-fund") {
      refuse("unsettled-custody", `HELP cannot pool '${assetId}' while current custody remains with '${custodyAccount}'; settle custody first`);
    }

    const reason = reserve.has(assetId) ? exactString(reserve.get(assetId).reason, `arbitrage.reserve.${assetId}.reason`) : null;
    if (uses.has(assetId)) {
      const use = uses.get(assetId);
      if (helpUse === 0n) refuse("zero-liquidity-use", `liquidity use for '${assetId}' must be positive or omitted`);
      const pool = exactString(use.pool, `liquidity.uses.${assetId}.pool`);
      if (!pool.includes(":")) refuse("malformed-pool", `liquidity pool '${pool}' must name both assets`);
      liquidityLines.push(Object.freeze({ assetId, symbol, custodyAccount, units: helpUse.toString(), pool }));
    }
    if (released > 0n) releaseLines.push(Object.freeze({ assetId, symbol, custodyAccount, units: released.toString() }));
    allocations.push(Object.freeze({
      assetId,
      symbol,
      custodyAccount,
      precision,
      protected: protectedAsset,
      availableUnits: available.toString(),
      arbitrageReserveUnits: reserved.toString(),
      releasedSurplusUnits: released.toString(),
      helpLiquidityUnits: helpUse.toString(),
      helpOperationalReserveUnits: helpMinimum.toString(),
      idleReleasedUnits: (released - helpUse).toString(),
      ...(reason ? { reserveReason: reason } : {}),
    }));
  }

  const pools = new Map();
  for (const line of liquidityLines) {
    const held = pools.get(line.pool) ?? [];
    held.push(line);
    pools.set(line.pool, held);
  }
  for (const [pool, lines] of pools) {
    const tokens = pool.split(":");
    if (tokens.length !== 2 || tokens[0] === tokens[1] || lines.length !== 2
        || !tokens.every((token) => lines.some((line) => line.symbol === token))) {
      refuse("incomplete-pool-legs", `pool '${pool}' must carry one positive, custody-settled use for each of its two exact symbols`);
    }
  }

  const releaseBody = Object.freeze({
    schema: "agrodao.sigmund-surplus-release.v1",
    producer: SIGMUND_ENTERPRISE,
    consumer: HELP_ENTERPRISE,
    observationId,
    validFrom: request.observedAt,
    expiresAt: request.expiresAt,
    lines: Object.freeze(releaseLines),
  });
  const releaseId = semanticId(releaseBody);
  const decisionBody = Object.freeze({
    schema: CAPITAL_DECISION_SCHEMA,
    requestedBy: TREASURY_STEWARD,
    observationId,
    observedAt: request.observedAt,
    expiresAt: request.expiresAt,
    capitalPriority: Object.freeze([`${arbitrageAccount}:arbitrage`, "help-fund:liquidity"]),
    allocations: Object.freeze(allocations),
    surplusRelease: Object.freeze({ ...releaseBody, releaseId }),
    liquidityLines: Object.freeze(liquidityLines),
    executionAuthority: false,
    executor: AAGAARD_ENTERPRISE,
  });
  const decisionId = semanticId(decisionBody);

  return Object.freeze({
    ...decisionBody,
    decisionId,
    authorizations: Object.freeze({
      arbitrage: authorization({
        issuer: SIGMUND_ENTERPRISE,
        account: arbitrageAccount,
        lane: "arbitrage",
        actions: ["trade", "trade-bundle"],
        decisionId,
        observationId,
        plan: arbitragePlan,
        validFrom: request.observedAt,
        expiresAt: request.expiresAt,
      }),
      liquidity: authorization({
        issuer: HELP_ENTERPRISE,
        account: "help-fund",
        lane: "liquidity",
        actions: ["lp"],
        decisionId,
        observationId,
        plan: liquidityPlan,
        validFrom: request.observedAt,
        expiresAt: request.expiresAt,
        releaseId,
      }),
    }),
  });
}

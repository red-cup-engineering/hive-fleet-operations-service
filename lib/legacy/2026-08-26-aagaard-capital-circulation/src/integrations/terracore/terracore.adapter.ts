export interface TerraCorePlayerState {
  readonly account: string;
  /** Exact decimal lexeme observed in the HTTP response, not a JS float. */
  readonly scrap: string;
  /** Exact decimal lexeme observed in the HTTP response, not a JS float. */
  readonly mineRate: string;
  readonly health: number;
  readonly damage: number;
  readonly defense: number;
  readonly engineering: number;
  readonly effectiveDamage: number;
  readonly effectiveDefense: number;
  readonly effectiveDodge: number;
  readonly effectiveCrit: number;
  readonly effectiveProtection: number;
  readonly attacks: number;
  readonly maxAttacks: number;
  readonly lastClaimMs?: number;
  readonly lastBattleMs?: number;
  readonly lastUpgradeMs?: number;
  readonly observedAt: string;
}

export interface TerraCoreClient {
  readPlayer(account: string): Promise<TerraCorePlayerState>;
}

export interface TerraCoreClientOptions {
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

export interface TerraCoreCustomJsonIntent {
  readonly operation: readonly ["custom_json", Readonly<{
    readonly required_auths: readonly string[];
    readonly required_posting_auths: readonly string[];
    readonly id: "terracore_claim" | "terracore_battle" | "ssc-mainnet-hive";
    readonly json: string;
  }>];
  readonly role: "posting" | "active";
  readonly approvedForBroadcast: false;
}

export interface TerraCoreClaimCandidate extends TerraCoreCustomJsonIntent {
  readonly kind: "claim-scrap";
  readonly account: string;
  readonly amount: string;
  readonly observedScrap: string;
  readonly reason: string;
}

export interface TerraCoreActionRefusal {
  readonly action: "claim-scrap" | "battle";
  readonly reason: string;
}

export interface TerraCoreActionPlan {
  readonly account: string;
  readonly observedAt: string;
  readonly actions: readonly TerraCoreClaimCandidate[];
  readonly refusals: readonly TerraCoreActionRefusal[];
  readonly locked: true;
}

export interface TerraCoreBattleTargetState {
  readonly account: string;
  readonly scrap: string;
  readonly defense: number;
  readonly dodge: number;
  readonly protection: number;
  readonly observedAt: string;
}

export interface TerraCoreBattleSnapshot {
  readonly observedAt: string;
  readonly targets: readonly TerraCoreBattleTargetState[];
}

export interface TerraCoreBattlePolicy {
  readonly minimumTargetScrap: string;
  readonly maximumTargetDodge: number;
  readonly maximumDefenseNumerator: number;
  readonly maximumDefenseDenominator: number;
  readonly maximumObservationAgeMs: number;
}

export type TerraCoreBattleSelection =
  | (TerraCoreCustomJsonIntent & {
      readonly kind: "battle";
      readonly account: string;
      readonly target: TerraCoreBattleTargetState;
      readonly reason: string;
    })
  | { readonly kind: "refuse"; readonly reason: string };

export interface TerraCoreEngineeringUpgradeState {
  readonly player: TerraCorePlayerState;
  readonly liquidScrap: string;
  readonly scrapPrecision: number;
}

export interface TerraCoreEngineeringUpgradeQuote {
  readonly fromLevel: number;
  readonly toLevel: number;
  readonly costScrap: string;
  readonly retainedLiquidScrap: string;
  readonly currentScrapPerDay: string;
  readonly expectedScrapPerDay: string;
  readonly incrementalScrapPerDay: string;
  readonly paybackMilliDays: number;
}

export type TerraCoreEngineeringUpgradePlan =
  | { readonly kind: "ready"; readonly reason: string; readonly quote: TerraCoreEngineeringUpgradeQuote }
  | { readonly kind: "refuse"; readonly reason: string };

type JsonRecord = Readonly<Record<string, unknown>>;

const HIVE_ACCOUNT = /^(?=.{3,16}$)[a-z](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z](?:[a-z0-9-]*[a-z0-9])?)*$/;
const UNSIGNED_DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/;

function accountName(value: unknown, field = "account"): string {
  if (typeof value !== "string" || !HIVE_ACCOUNT.test(value)) throw new Error(`invalid Hive ${field}`);
  return value;
}

function record(value: unknown): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("TerraCore player response must be an object");
  return value as JsonRecord;
}

function nonnegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`TerraCore ${field} must be a nonnegative safe integer`);
  return value;
}

function nonnegativeNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`TerraCore ${field} must be a nonnegative finite number`);
  return value;
}

function optionalTimestamp(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return nonnegativeInteger(value, field);
}

function skipWhitespace(body: string, from: number): number {
  let cursor = from;
  while (/\s/.test(body[cursor] ?? "")) cursor += 1;
  return cursor;
}

function stringEnd(body: string, from: number): number {
  if (body[from] !== '"') throw new Error("expected JSON string");
  let escaped = false;
  for (let cursor = from + 1; cursor < body.length; cursor += 1) {
    const char = body[cursor];
    if (escaped) escaped = false;
    else if (char === "\\") escaped = true;
    else if (char === '"') return cursor + 1;
  }
  throw new Error("unterminated JSON string");
}

/** Return exact source lexemes for one immediate property of a JSON object. */
function topLevelLexemes(body: string, field: string): readonly string[] {
  let cursor = skipWhitespace(body, 0);
  if (body[cursor] !== "{") throw new Error("TerraCore player response must be a JSON object");
  cursor += 1;
  const values: string[] = [];
  while (true) {
    cursor = skipWhitespace(body, cursor);
    if (body[cursor] === "}") return values;
    const keyStart = cursor;
    const keyEnd = stringEnd(body, keyStart);
    const key = JSON.parse(body.slice(keyStart, keyEnd)) as unknown;
    cursor = skipWhitespace(body, keyEnd);
    if (body[cursor] !== ":") throw new Error("expected JSON property separator");
    cursor = skipWhitespace(body, cursor + 1);
    const valueStart = cursor;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (; cursor < body.length; cursor += 1) {
      const char = body[cursor];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{" || char === "[") depth += 1;
      else if (char === "}" || char === "]") {
        if (depth === 0) break;
        depth -= 1;
      } else if (char === "," && depth === 0) break;
    }
    if (typeof key === "string" && key === field) values.push(body.slice(valueStart, cursor).trim());
    cursor = skipWhitespace(body, cursor);
    if (body[cursor] === ",") {
      cursor += 1;
      continue;
    }
    if (body[cursor] === "}") return values;
    throw new Error("expected end of JSON property");
  }
}

/**
 * Read one top-level numeric field's source lexeme. TerraCore currently emits
 * SCRAP and mine-rate values as JSON numbers. JSON.parse would first round
 * them through binary floating point, so signed amounts are derived from the
 * response bytes instead. Duplicate fields and exponent notation are refused.
 */
function exactTopLevelDecimal(body: string, parsed: JsonRecord, field: string): string {
  const parsedValue = parsed[field];
  if ((typeof parsedValue !== "number" || !Number.isFinite(parsedValue) || parsedValue < 0) && typeof parsedValue !== "string") {
    throw new Error(`TerraCore ${field} must be a nonnegative decimal`);
  }
  const matches = topLevelLexemes(body, field);
  if (matches.length !== 1) throw new Error(`TerraCore ${field} must occur exactly once as a top-level field`);
  const lexeme = matches[0] ?? "";
  if (typeof parsedValue === "string") {
    const decoded = JSON.parse(lexeme) as unknown;
    if (decoded !== parsedValue) throw new Error(`TerraCore ${field} source value disagrees with parsed value`);
    return exactUnsignedDecimal(parsedValue, field);
  }
  return exactUnsignedDecimal(lexeme, field);
}

function exactUnsignedDecimal(value: string, field: string): string {
  if (value.length > 80 || !UNSIGNED_DECIMAL.test(value)) throw new Error(`TerraCore ${field} must be an unsigned plain decimal`);
  return value;
}

function decimalAtScale(value: string, scale: number, field: string): string {
  exactUnsignedDecimal(value, field);
  const [whole = "", fraction = ""] = value.split(".");
  const scaled = `${fraction}${"0".repeat(scale)}`.slice(0, scale);
  return `${whole}.${scaled}`;
}

function decimalUnits(value: string, scale: number, field: string): bigint {
  const normalized = decimalAtScale(value, scale, field);
  const [whole = "0", fraction = ""] = normalized.split(".");
  return BigInt(`${whole}${fraction}`);
}

function formatUnits(value: bigint, scale: number): string {
  if (value < 0n) throw new Error("TerraCore amount cannot be negative");
  const factor = 10n ** BigInt(scale);
  if (scale === 0) return value.toString();
  return `${value / factor}.${(value % factor).toString().padStart(scale, "0")}`;
}

function dailyUnits8(rate: string): bigint {
  exactUnsignedDecimal(rate, "mine rate");
  const [whole = "0", fraction = ""] = rate.split(".");
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(`${whole}${fraction}`);
  return numerator * 86_400n * 100_000_000n / denominator;
}

export function parseTerraCorePlayer(body: string, observedAt = new Date().toISOString()): TerraCorePlayerState {
  let decoded: unknown;
  try {
    decoded = JSON.parse(body) as unknown;
  } catch {
    throw new Error("TerraCore player response is not valid JSON");
  }
  const player = record(decoded);
  const stats = player["stats"] === undefined ? null : record(player["stats"]);
  const damage = nonnegativeInteger(player["damage"], "damage");
  const defense = nonnegativeInteger(player["defense"], "defense");
  const lastClaimMs = optionalTimestamp(player["lastclaim"], "lastclaim");
  const lastBattleMs = optionalTimestamp(player["lastBattle"], "lastBattle");
  const lastUpgradeMs = optionalTimestamp(player["last_upgrade_time"], "last_upgrade_time");
  return Object.freeze({
    account: accountName(player["username"], "username"),
    scrap: exactTopLevelDecimal(body, player, "scrap"),
    mineRate: exactTopLevelDecimal(body, player, "minerate"),
    health: nonnegativeInteger(player["health"], "health"),
    damage,
    defense,
    engineering: nonnegativeInteger(player["engineering"], "engineering"),
    effectiveDamage: stats ? nonnegativeNumber(stats["damage"], "effective damage") : damage,
    effectiveDefense: stats ? nonnegativeNumber(stats["defense"], "effective defense") : defense,
    effectiveDodge: stats ? nonnegativeNumber(stats["dodge"], "effective dodge") : 0,
    effectiveCrit: stats ? nonnegativeNumber(stats["crit"], "effective crit") : 0,
    effectiveProtection: stats ? nonnegativeNumber(stats["protection"] ?? 0, "effective protection") : 0,
    attacks: nonnegativeInteger(player["attacks"], "attacks"),
    maxAttacks: nonnegativeInteger(player["maxAttacks"], "maxAttacks"),
    ...(lastClaimMs === undefined ? {} : { lastClaimMs }),
    ...(lastBattleMs === undefined ? {} : { lastBattleMs }),
    ...(lastUpgradeMs === undefined ? {} : { lastUpgradeMs }),
    observedAt,
  });
}

export function createTerraCoreClient(options: TerraCoreClientOptions = {}): TerraCoreClient {
  const endpoint = (options.endpoint ?? "https://api.terracoregame.com").replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  return Object.freeze({
    async readPlayer(account: string): Promise<TerraCorePlayerState> {
      const admittedAccount = accountName(account);
      const response = await fetchImpl(`${endpoint}/player/${encodeURIComponent(admittedAccount)}`, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(`TerraCore player read failed (${response.status})`);
      const state = parseTerraCorePlayer(await response.text(), now().toISOString());
      if (state.account !== admittedAccount) throw new Error(`TerraCore returned ${state.account} for ${admittedAccount}`);
      return state;
    },
  });
}

export function terraCoreClaimIntent(account: string, amount: string): TerraCoreCustomJsonIntent {
  const admittedAccount = accountName(account);
  const normalized = decimalAtScale(amount, 8, "claim amount");
  if (decimalUnits(normalized, 8, "claim amount") === 0n) throw new Error("TerraCore claim amount must be positive at 8-decimal precision");
  return Object.freeze({
    role: "posting" as const,
    approvedForBroadcast: false as const,
    operation: Object.freeze(["custom_json", Object.freeze({
      required_auths: Object.freeze([] as const),
      required_posting_auths: Object.freeze([admittedAccount]),
      id: "terracore_claim" as const,
      json: JSON.stringify({ amount: normalized }),
    })] as const),
  });
}

export function terraCoreBattleIntent(account: string, target: string): TerraCoreCustomJsonIntent {
  const admittedAccount = accountName(account);
  const admittedTarget = accountName(target, "battle target");
  if (admittedAccount === admittedTarget) throw new Error("TerraCore battle target must differ from actor");
  return Object.freeze({
    role: "posting" as const,
    approvedForBroadcast: false as const,
    operation: Object.freeze(["custom_json", Object.freeze({
      required_auths: Object.freeze([] as const),
      required_posting_auths: Object.freeze([admittedAccount]),
      id: "terracore_battle" as const,
      json: JSON.stringify({ target: admittedTarget }),
    })] as const),
  });
}

export function terraCoreBattleTargetFromPlayer(player: TerraCorePlayerState): TerraCoreBattleTargetState {
  return Object.freeze({
    account: player.account,
    scrap: decimalAtScale(player.scrap, 8, "target scrap"),
    defense: player.effectiveDefense,
    dodge: player.effectiveDodge,
    protection: player.effectiveProtection,
    observedAt: player.observedAt,
  });
}

export function parseTerraCoreBattleTargets(body: string, observedAt = new Date().toISOString()): TerraCoreBattleSnapshot {
  let decoded: unknown;
  try { decoded = JSON.parse(body) as unknown; } catch { throw new Error("TerraCore target response is not valid JSON"); }
  const outer = record(decoded);
  const players = outer["players"];
  if (!Array.isArray(players)) throw new Error("TerraCore target response must contain a players array");
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error("TerraCore target observation timestamp is invalid");
  const targets = players.map((value) => {
    const target = record(value);
    const stats = record(target["stats"]);
    const rawScrap = target["scrap"];
    if ((typeof rawScrap !== "number" || !Number.isFinite(rawScrap) || rawScrap < 0) && typeof rawScrap !== "string") {
      throw new Error("TerraCore target scrap must be a nonnegative decimal");
    }
    return Object.freeze({
      account: accountName(target["username"], "target username"),
      scrap: decimalAtScale(String(rawScrap), 8, "target scrap"),
      defense: nonnegativeNumber(stats["defense"], "target effective defense"),
      dodge: nonnegativeNumber(stats["dodge"], "target effective dodge"),
      protection: nonnegativeNumber(stats["protection"] ?? 0, "target effective protection"),
      observedAt,
    });
  });
  if (new Set(targets.map((target) => target.account)).size !== targets.length) throw new Error("TerraCore target response contains duplicate accounts");
  return Object.freeze({ observedAt, targets: Object.freeze(targets) });
}

function statMilli(value: number, field: string): bigint {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER / 1000) throw new Error(`TerraCore ${field} is outside ranking bounds`);
  return BigInt(Math.floor(value * 1000));
}

export function selectTerraCoreBattleTarget(
  actor: TerraCorePlayerState,
  snapshot: TerraCoreBattleSnapshot,
  excludedAccounts: readonly string[],
  now = new Date(),
  policy: TerraCoreBattlePolicy = Object.freeze({
    minimumTargetScrap: "20.00000000",
    maximumTargetDodge: 10,
    maximumDefenseNumerator: 2,
    maximumDefenseDenominator: 3,
    maximumObservationAgeMs: 30_000,
  }),
): TerraCoreBattleSelection {
  try {
    if (actor.attacks < 1) return Object.freeze({ kind: "refuse", reason: "the actor has no regenerated attack" });
    if (!Number.isSafeInteger(policy.maximumObservationAgeMs) || policy.maximumObservationAgeMs < 1
      || !Number.isSafeInteger(policy.maximumDefenseNumerator) || policy.maximumDefenseNumerator < 1
      || !Number.isSafeInteger(policy.maximumDefenseDenominator) || policy.maximumDefenseDenominator < 1
      || policy.maximumDefenseNumerator >= policy.maximumDefenseDenominator
      || !Number.isFinite(policy.maximumTargetDodge) || policy.maximumTargetDodge < 0 || policy.maximumTargetDodge > 100) {
      throw new Error("invalid TerraCore battle policy");
    }
    const observedMs = Date.parse(snapshot.observedAt);
    const ageMs = now.getTime() - observedMs;
    if (!Number.isFinite(observedMs) || ageMs < 0 || ageMs > policy.maximumObservationAgeMs) {
      return Object.freeze({ kind: "refuse", reason: "the TerraCore target snapshot is stale or future-dated" });
    }
    const excluded = new Set(excludedAccounts.map((account) => accountName(account, "excluded account")));
    excluded.add(actor.account);
    const minimum = decimalUnits(policy.minimumTargetScrap, 8, "minimum target scrap");
    const actorDamage = statMilli(actor.effectiveDamage, "actor effective damage");
    const candidates = snapshot.targets.filter((target) => {
      const defense = statMilli(target.defense, "target effective defense");
      return !excluded.has(target.account)
        && target.protection === 0
        && target.dodge <= policy.maximumTargetDodge
        && defense * BigInt(policy.maximumDefenseDenominator) <= actorDamage * BigInt(policy.maximumDefenseNumerator)
        && decimalUnits(target.scrap, 8, "target scrap") >= minimum;
    }).map((target) => {
      const scrap = decimalUnits(target.scrap, 8, "target scrap");
      const dodgeBps = BigInt(Math.min(10_000, Math.max(0, Math.floor(target.dodge * 100))));
      const damageMargin = actorDamage - statMilli(target.defense, "target effective defense");
      return Object.freeze({ target, score: scrap * (10_000n - dodgeBps) * damageMargin });
    }).sort((left, right) => left.score === right.score
      ? left.target.account.localeCompare(right.target.account)
      : left.score > right.score ? -1 : 1);
    const selected = candidates[0]?.target;
    if (!selected) return Object.freeze({ kind: "refuse", reason: "no fresh non-fleet target satisfies the conservative stash, protection, dodge, and defense policy" });
    const intent = terraCoreBattleIntent(actor.account, selected.account);
    return Object.freeze({
      ...intent,
      kind: "battle" as const,
      account: actor.account,
      target: selected,
      reason: "use one otherwise capped attack against the highest conservative fresh target score without spending a token",
    });
  } catch (error) {
    return Object.freeze({ kind: "refuse", reason: `invalid TerraCore battle evidence: ${error instanceof Error ? error.message : String(error)}` });
  }
}

export function planTerraCoreActions(state: TerraCorePlayerState, minimumClaimScrap = "10.00000000"): TerraCoreActionPlan {
  const observed = decimalAtScale(state.scrap, 8, "observed scrap");
  const minimum = decimalAtScale(minimumClaimScrap, 8, "minimum claim");
  const actions: TerraCoreClaimCandidate[] = [];
  const refusals: TerraCoreActionRefusal[] = [];
  if (decimalUnits(observed, 8, "observed scrap") >= decimalUnits(minimum, 8, "minimum claim")
    && decimalUnits(observed, 8, "observed scrap") > 0n) {
    const intent = terraCoreClaimIntent(state.account, observed);
    actions.push(Object.freeze({
      ...intent,
      kind: "claim-scrap" as const,
      account: state.account,
      amount: observed,
      observedScrap: state.scrap,
      reason: "move accumulated SCRAP out of the raid-exposed in-game stash",
    }));
  } else {
    refusals.push(Object.freeze({ action: "claim-scrap", reason: `observed stash ${observed} is below policy minimum ${minimum}` }));
  }
  if (state.attacks > 0) {
    refusals.push(Object.freeze({ action: "battle", reason: "no snapshot-consistent target-selection and expected-value evidence was supplied" }));
  }
  return Object.freeze({
    account: state.account,
    observedAt: state.observedAt,
    actions: Object.freeze(actions),
    refusals: Object.freeze(refusals),
    locked: true as const,
  });
}

export function terraCoreEngineeringUpgradeIntent(
  account: string,
  costScrap: string,
  actionNonce: string,
): TerraCoreCustomJsonIntent {
  const admittedAccount = accountName(account);
  const cost = decimalAtScale(costScrap, 8, "engineering upgrade cost");
  if (decimalUnits(cost, 8, "engineering upgrade cost") <= 0n) throw new Error("TerraCore engineering upgrade cost must be positive");
  if (!/^[0-9a-f]{16}$/.test(actionNonce)) throw new Error("TerraCore engineering action nonce must be 16 lowercase hexadecimal characters");
  return Object.freeze({
    role: "active" as const,
    approvedForBroadcast: false as const,
    operation: Object.freeze(["custom_json", Object.freeze({
      required_auths: Object.freeze([admittedAccount]),
      required_posting_auths: Object.freeze([] as const),
      id: "ssc-mainnet-hive" as const,
      json: JSON.stringify({
        contractName: "tokens",
        contractAction: "transfer",
        contractPayload: {
          symbol: "SCRAP",
          to: "null",
          quantity: cost,
          memo: `terracore_engineering-${actionNonce}`,
        },
      }),
    })] as const),
  });
}

export function planTerraCoreEngineeringUpgrade(
  state: TerraCoreEngineeringUpgradeState,
  minimumRetainedScrap = "50.00000000",
  maximumPaybackMilliDays = 7_000,
): TerraCoreEngineeringUpgradePlan {
  try {
    if (state.scrapPrecision !== 8) throw new Error("SCRAP precision changed");
    if (!Number.isSafeInteger(maximumPaybackMilliDays) || maximumPaybackMilliDays < 1) throw new Error("invalid engineering payback policy");
    const level = state.player.engineering;
    if (level !== 14) throw new Error(`bounded first upgrade requires base Engineering 14, observed ${level}`);
    const costUnits = BigInt(level * level) * 100_000_000n;
    const liquidUnits = decimalUnits(state.liquidScrap, 8, "liquid SCRAP");
    const retainedUnits = liquidUnits - costUnits;
    const reserveUnits = decimalUnits(minimumRetainedScrap, 8, "minimum retained SCRAP");
    if (retainedUnits < reserveUnits) throw new Error("engineering upgrade would breach the liquid SCRAP reserve");
    const currentDaily = dailyUnits8(state.player.mineRate);
    const nextLevel = level + 1;
    // Production client getMinerate: (engineering + 1)^2 / 172800
    // SCRAP/second. Multiplying by 86400 gives square/2 SCRAP/day.
    const expectedDaily = BigInt((nextLevel + 1) ** 2) * 50_000_000n;
    const incrementalDaily = expectedDaily - currentDaily;
    if (incrementalDaily <= 0n) throw new Error("engineering upgrade does not prove a positive observed daily increment");
    const paybackMilli = costUnits * 1_000n / incrementalDaily;
    if (paybackMilli > BigInt(maximumPaybackMilliDays)) throw new Error("engineering upgrade exceeds the payback policy");
    if (paybackMilli > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("engineering payback is outside safe reporting bounds");
    return Object.freeze({
      kind: "ready",
      reason: "one exact Engineering upgrade restores the inactivity-decayed mine rate while retaining the SCRAP reserve",
      quote: Object.freeze({
        fromLevel: level,
        toLevel: nextLevel,
        costScrap: formatUnits(costUnits, 8),
        retainedLiquidScrap: formatUnits(retainedUnits, 8),
        currentScrapPerDay: formatUnits(currentDaily, 8),
        expectedScrapPerDay: formatUnits(expectedDaily, 8),
        incrementalScrapPerDay: formatUnits(incrementalDaily, 8),
        paybackMilliDays: Number(paybackMilli),
      }),
    });
  } catch (error) {
    return Object.freeze({ kind: "refuse", reason: `invalid TerraCore engineering-upgrade evidence: ${error instanceof Error ? error.message : String(error)}` });
  }
}

export function reconcileTerraCoreEngineeringUpgrade(
  before: TerraCoreEngineeringUpgradeState,
  after: TerraCoreEngineeringUpgradeState,
  quote: TerraCoreEngineeringUpgradeQuote,
): Readonly<{ confirmed: boolean; reason: string }> {
  try {
    if (before.player.account !== after.player.account) throw new Error("upgrade observations name different accounts");
    if (after.player.engineering !== quote.toLevel || before.player.engineering !== quote.fromLevel) throw new Error("Engineering did not increase by the quoted level");
    if ((after.player.lastUpgradeMs ?? 0) <= (before.player.lastUpgradeMs ?? 0)) throw new Error("last-upgrade timestamp did not advance");
    if (dailyUnits8(after.player.mineRate) <= dailyUnits8(before.player.mineRate)) throw new Error("observed mine rate did not increase");
    const spent = decimalUnits(before.liquidScrap, 8, "before liquid SCRAP") - decimalUnits(after.liquidScrap, 8, "after liquid SCRAP");
    if (spent !== decimalUnits(quote.costScrap, 8, "quoted cost")) throw new Error("liquid SCRAP delta does not equal the exact upgrade cost");
    return Object.freeze({ confirmed: true, reason: "Engineering, activity timestamp, mine rate, and exact SCRAP spend all reconciled" });
  } catch (error) {
    return Object.freeze({ confirmed: false, reason: error instanceof Error ? error.message : String(error) });
  }
}

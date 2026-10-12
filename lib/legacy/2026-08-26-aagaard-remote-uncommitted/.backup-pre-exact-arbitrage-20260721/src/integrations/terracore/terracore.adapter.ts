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
  readonly attacks: number;
  readonly maxAttacks: number;
  readonly lastClaimMs?: number;
  readonly lastBattleMs?: number;
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
    readonly required_auths: readonly [];
    readonly required_posting_auths: readonly string[];
    readonly id: "terracore_claim" | "terracore_battle";
    readonly json: string;
  }>];
  readonly role: "posting";
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

export function parseTerraCorePlayer(body: string, observedAt = new Date().toISOString()): TerraCorePlayerState {
  let decoded: unknown;
  try {
    decoded = JSON.parse(body) as unknown;
  } catch {
    throw new Error("TerraCore player response is not valid JSON");
  }
  const player = record(decoded);
  const lastClaimMs = optionalTimestamp(player["lastclaim"], "lastclaim");
  const lastBattleMs = optionalTimestamp(player["lastBattle"], "lastBattle");
  return Object.freeze({
    account: accountName(player["username"], "username"),
    scrap: exactTopLevelDecimal(body, player, "scrap"),
    mineRate: exactTopLevelDecimal(body, player, "minerate"),
    health: nonnegativeInteger(player["health"], "health"),
    damage: nonnegativeInteger(player["damage"], "damage"),
    defense: nonnegativeInteger(player["defense"], "defense"),
    engineering: nonnegativeInteger(player["engineering"], "engineering"),
    attacks: nonnegativeInteger(player["attacks"], "attacks"),
    maxAttacks: nonnegativeInteger(player["maxAttacks"], "maxAttacks"),
    ...(lastClaimMs === undefined ? {} : { lastClaimMs }),
    ...(lastBattleMs === undefined ? {} : { lastBattleMs }),
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

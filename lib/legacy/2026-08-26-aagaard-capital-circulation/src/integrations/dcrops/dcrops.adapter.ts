export interface DCropsNftInstance {
  readonly _id: number;
  readonly account: string;
  readonly soulBound?: boolean;
  readonly properties: Readonly<Record<string, string>>;
}

export interface DCropsSeasonState {
  readonly index: 0 | 1 | 2 | 3;
  readonly name: "Spring" | "Summer" | "Fall" | "Winter";
  readonly startedAtUnix: number;
  readonly endsAtUnix: number;
}

export interface DCropsLandState {
  readonly id: number;
  readonly account: string;
  readonly name: string;
  readonly plots: readonly string[];
  readonly plantedAtUnix: readonly (number | null)[];
}

export interface DCropsSeedState {
  readonly id: number;
  readonly account: string;
  readonly name: string;
  readonly seasons: readonly number[];
  readonly growthDays: number;
  readonly cooldownAtUnix: number;
}

export interface DCropsCustomJsonIntent {
  readonly role: "active";
  readonly approvedForBroadcast: false;
  readonly operation: readonly ["custom_json", Readonly<{
    readonly required_auths: readonly string[];
    readonly required_posting_auths: readonly [];
    readonly id: "dcrops";
    readonly json: string;
  }>];
}

export interface DCropsClient {
  readInstance(id: number): Promise<DCropsNftInstance>;
  readSeason(): Promise<DCropsSeasonState>;
}

export interface DCropsPlotPlan {
  readonly kind: "remove-expired" | "plant" | "harvest" | "wait" | "refuse";
  readonly reason: string;
  readonly intent?: DCropsCustomJsonIntent;
  readonly nextEligibleAtUnix?: number;
}

type JsonRecord = Readonly<Record<string, unknown>>;

const ACCOUNT = /^(?=.{3,16}$)[a-z](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z](?:[a-z0-9-]*[a-z0-9])?)*$/;
const SEASONS = ["Spring", "Summer", "Fall", "Winter"] as const;
const DAY = 24 * 60 * 60;
const SEASON_SECONDS = 15 * DAY;
const HARVEST_EXPIRY_SECONDS = 30 * DAY;
const SEED_COOLDOWN_SECONDS = 14 * DAY;

function record(value: unknown, field: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`dCrops ${field} must be an object`);
  return value as JsonRecord;
}

function integer(value: unknown, field: string, minimum = 0): number {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`dCrops ${field} must be a nonnegative safe integer`);
  }
  return parsed;
}

function positiveId(value: unknown, field: string): number {
  return integer(value, field, 1);
}

function accountName(value: unknown): string {
  if (typeof value !== "string" || !ACCOUNT.test(value)) throw new Error("invalid dCrops Hive account");
  return value;
}

function parsePropertyJson(properties: JsonRecord, key: string): JsonRecord {
  const raw = properties[key];
  if (typeof raw !== "string") throw new Error(`dCrops property ${key} must be JSON text`);
  try {
    return record(JSON.parse(raw) as unknown, `property ${key}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("dCrops")) throw error;
    throw new Error(`dCrops property ${key} is invalid JSON`);
  }
}

function exactKeys(value: JsonRecord, expected: readonly string[]): void {
  if (Object.keys(value).sort().join(",") !== [...expected].sort().join(",")) {
    throw new Error(`dCrops object must contain exactly ${expected.join(", ")}`);
  }
}

export function parseDCropsInstance(value: unknown): DCropsNftInstance {
  const row = record(value, "NFT instance");
  const properties = record(row["properties"], "NFT properties");
  const normalized: Record<string, string> = {};
  for (const [key, property] of Object.entries(properties)) {
    if (typeof property !== "string") throw new Error(`dCrops property ${key} must be text`);
    normalized[key] = property;
  }
  return Object.freeze({
    _id: positiveId(row["_id"], "NFT id"),
    account: accountName(row["account"]),
    ...(typeof row["soulBound"] === "boolean" ? { soulBound: row["soulBound"] } : {}),
    properties: Object.freeze(normalized),
  });
}

export function parseDCropsSeason(value: unknown): DCropsSeasonState {
  const instance = parseDCropsInstance(value);
  if (instance._id !== 1 || instance.account !== "dcrops") throw new Error("dCrops season must be canonical instance 1 owned by dcrops");
  const rawIndex = integer(instance.properties["primary"], "season index");
  if (rawIndex > 3) throw new Error("dCrops season index must be 0 through 3");
  const index = rawIndex as 0 | 1 | 2 | 3;
  const name = SEASONS[index];
  if (instance.properties["secondary"] !== name) throw new Error("dCrops season name disagrees with its index");
  const startedAtUnix = integer(instance.properties["tertiary"], "season start", 1);
  return Object.freeze({ index, name, startedAtUnix, endsAtUnix: startedAtUnix + SEASON_SECONDS });
}

export function parseDCropsLand(value: unknown, expectedAccount?: string): DCropsLandState {
  const instance = parseDCropsInstance(value);
  if (expectedAccount && instance.account !== accountName(expectedAccount)) throw new Error("dCrops land account disagrees with requested account");
  const primary = parsePropertyJson(instance.properties, "primary");
  if (primary["type"] !== "LAND") throw new Error("dCrops NFT is not land");
  const secondary = parsePropertyJson(instance.properties, "secondary");
  const tertiary = parsePropertyJson(instance.properties, "tertiary");
  const plots = secondary["p"];
  const timestamps = tertiary["t"];
  if (!Array.isArray(plots) || !Array.isArray(timestamps) || plots.length === 0 || plots.length !== timestamps.length) {
    throw new Error("dCrops land plots and timestamps must be equal nonempty arrays");
  }
  const admittedPlots = plots.map((plot) => {
    if (typeof plot !== "string") throw new Error("dCrops plot crop must be text");
    return plot;
  });
  const plantedAtUnix = timestamps.map((timestamp, index) => {
    if (admittedPlots[index] === "") {
      if (timestamp !== "") throw new Error("dCrops empty plot must have an empty timestamp");
      return null;
    }
    if (typeof timestamp !== "string" || !/^\d+(?:\.\d+)?$/.test(timestamp)) throw new Error("dCrops planted timestamp must be decimal text");
    return Math.trunc(Number(timestamp));
  });
  return Object.freeze({
    id: instance._id,
    account: instance.account,
    name: instance.properties["name"] ?? "",
    plots: Object.freeze(admittedPlots),
    plantedAtUnix: Object.freeze(plantedAtUnix),
  });
}

export function parseDCropsSeed(value: unknown, expectedAccount?: string): DCropsSeedState {
  const instance = parseDCropsInstance(value);
  if (expectedAccount && instance.account !== accountName(expectedAccount)) throw new Error("dCrops seed account disagrees with requested account");
  const primary = parsePropertyJson(instance.properties, "primary");
  const secondary = parsePropertyJson(instance.properties, "secondary");
  if (primary["type"] !== "SEED") throw new Error("dCrops NFT is not a seed");
  const seasons = primary["s"];
  if (!Array.isArray(seasons) || seasons.length === 0 || !seasons.every((season) => Number.isSafeInteger(season) && season >= 0 && season <= 3)) {
    throw new Error("dCrops seed seasons must be indexes 0 through 3");
  }
  return Object.freeze({
    id: instance._id,
    account: instance.account,
    name: instance.properties["name"] ?? "",
    seasons: Object.freeze(seasons as number[]),
    growthDays: integer(primary["gt"], "seed growth days", 1),
    cooldownAtUnix: integer(secondary["cd"], "seed cooldown timestamp"),
  });
}

function customJsonIntent(account: string, body: JsonRecord): DCropsCustomJsonIntent {
  const admittedAccount = accountName(account);
  return Object.freeze({
    role: "active" as const,
    approvedForBroadcast: false as const,
    operation: Object.freeze(["custom_json", Object.freeze({
      required_auths: Object.freeze([admittedAccount]),
      required_posting_auths: Object.freeze([] as const),
      id: "dcrops" as const,
      json: JSON.stringify(body),
    })] as const),
  });
}

export function dcropsRemoveIntent(account: string, landID: number, plotNo: number): DCropsCustomJsonIntent {
  return customJsonIntent(account, { operation: "removeMultiple", payload: [{ landID: positiveId(landID, "land id"), plots: [integer(plotNo, "plot number")] }] });
}

export function dcropsHarvestIntent(account: string, landID: number, plotNo: number): DCropsCustomJsonIntent {
  return customJsonIntent(account, { operation: "harvestMultiple", payload: [{ landID: positiveId(landID, "land id"), plots: [integer(plotNo, "plot number")] }] });
}

export function dcropsPlantIntent(account: string, landID: number, seedID: number, plotNo: number): DCropsCustomJsonIntent {
  return customJsonIntent(account, { operation: "plantMultiple", payload: [{ landID: positiveId(landID, "land id"), plant: [{ seedID: positiveId(seedID, "seed id"), plotNo: integer(plotNo, "plot number") }] }] });
}

export function planDCropsPlot(
  account: string,
  season: DCropsSeasonState,
  land: DCropsLandState,
  seed: DCropsSeedState,
  plotNo: number,
  nowUnix = Math.trunc(Date.now() / 1000),
): DCropsPlotPlan {
  const admittedAccount = accountName(account);
  const plot = integer(plotNo, "plot number");
  const now = integer(nowUnix, "observation timestamp", 1);
  if (land.account !== admittedAccount || seed.account !== admittedAccount) {
    return Object.freeze({ kind: "refuse", reason: "land and seed must both be owned by the acting account" });
  }
  if (plot >= land.plots.length) return Object.freeze({ kind: "refuse", reason: "plot number is outside the observed land" });
  if (now < season.startedAtUnix || now >= season.endsAtUnix) return Object.freeze({ kind: "refuse", reason: "season observation is stale or not yet active" });
  const crop = land.plots[plot];
  const plantedAt = land.plantedAtUnix[plot];
  if (crop === undefined || plantedAt === undefined) return Object.freeze({ kind: "refuse", reason: "plot observation is incomplete" });
  if (crop !== "") {
    if (plantedAt === null || plantedAt > now) return Object.freeze({ kind: "refuse", reason: "occupied plot has an invalid planting timestamp" });
    const age = now - plantedAt;
    if (age >= HARVEST_EXPIRY_SECONDS || crop !== seed.name || !seed.seasons.includes(season.index)) {
      return Object.freeze({
        kind: "remove-expired",
        reason: age >= HARVEST_EXPIRY_SECONDS ? "crop exceeded dCrops' 30-day harvest window" : "crop is not valid for the current selected seed and season",
        intent: dcropsRemoveIntent(admittedAccount, land.id, plot),
      });
    }
    const matureAt = plantedAt + seed.growthDays * DAY;
    if (now >= matureAt) {
      return Object.freeze({ kind: "harvest", reason: "crop is mature and still inside its harvest window", intent: dcropsHarvestIntent(admittedAccount, land.id, plot) });
    }
    return Object.freeze({ kind: "wait", reason: "crop is still growing", nextEligibleAtUnix: matureAt });
  }
  if (plantedAt !== null) return Object.freeze({ kind: "refuse", reason: "empty plot has a nonempty planting timestamp" });
  if (!seed.seasons.includes(season.index)) return Object.freeze({ kind: "refuse", reason: "seed is not valid in the current season" });
  const seedReadyAt = seed.cooldownAtUnix + SEED_COOLDOWN_SECONDS;
  if (now <= seedReadyAt) return Object.freeze({ kind: "wait", reason: "seed is still in its 14-day cooldown", nextEligibleAtUnix: seedReadyAt + 1 });
  const matureAt = now + seed.growthDays * DAY;
  if (matureAt >= season.endsAtUnix) return Object.freeze({ kind: "refuse", reason: "seed cannot mature before the observed season ends" });
  return Object.freeze({ kind: "plant", reason: "empty plot, eligible seed, and sufficient season time", intent: dcropsPlantIntent(admittedAccount, land.id, seed.id, plot) });
}

export function createDCropsClient(options: { readonly nodes?: readonly string[]; readonly fetchImpl?: typeof fetch } = {}): DCropsClient {
  const nodes = options.nodes ?? ["https://api.hive-engine.com/rpc/contracts", "https://herpc.dtools.dev/contracts"];
  const fetchImpl = options.fetchImpl ?? fetch;
  if (nodes.length === 0) throw new Error("dCrops client requires at least one Hive-Engine node");
  async function readInstance(id: number): Promise<DCropsNftInstance> {
    const admittedId = positiveId(id, "NFT id");
    let lastError: unknown;
    for (const node of nodes) {
      try {
        const response = await fetchImpl(node, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "findOne", params: { contract: "nft", table: "DCROPSinstances", query: { _id: admittedId } } }),
          signal: AbortSignal.timeout(6000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const envelope = record(await response.json() as unknown, "RPC response");
        if (!envelope["result"]) throw new Error(`dCrops NFT ${admittedId} was not found`);
        const parsed = parseDCropsInstance(envelope["result"]);
        if (parsed._id !== admittedId) throw new Error("dCrops RPC returned the wrong NFT id");
        return parsed;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`dCrops NFT read failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }
  return Object.freeze({ readInstance, async readSeason() { return parseDCropsSeason(await readInstance(1)); } });
}

export function validateDCropsActionJson(value: unknown): void {
  const body = record(value, "action");
  exactKeys(body, ["operation", "payload"]);
  const operation = body["operation"];
  if (operation !== "removeMultiple" && operation !== "harvestMultiple" && operation !== "plantMultiple") {
    throw new Error("dCrops operation is not an admitted plot action");
  }
  const payload = body["payload"];
  if (!Array.isArray(payload) || payload.length !== 1) throw new Error("dCrops action must target exactly one land");
  const target = record(payload[0], "action target");
  positiveId(target["landID"], "land id");
  if (operation === "plantMultiple") {
    exactKeys(target, ["landID", "plant"]);
    const plant = target["plant"];
    if (!Array.isArray(plant) || plant.length !== 1) throw new Error("dCrops plant action must target exactly one plot");
    const selection = record(plant[0], "plant selection");
    exactKeys(selection, ["seedID", "plotNo"]);
    positiveId(selection["seedID"], "seed id");
    integer(selection["plotNo"], "plot number");
  } else {
    exactKeys(target, ["landID", "plots"]);
    const plots = target["plots"];
    if (!Array.isArray(plots) || plots.length !== 1) throw new Error("dCrops action must target exactly one plot");
    integer(plots[0], "plot number");
  }
}

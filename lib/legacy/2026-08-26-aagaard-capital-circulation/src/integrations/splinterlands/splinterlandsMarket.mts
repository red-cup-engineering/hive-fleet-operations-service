export const SPLINTERLANDS_ROSTER_PURCHASE_POLICY = Object.freeze({
  account: "michael561",
  currency: "CREDITS",
  maximumCredits: 320,
  minimumCreditReserve: 64,
  lane: "gaming",
  target: "splinterlands-modern-roster-v1",
  cards: Object.freeze([
    Object.freeze({ cardDetailId: 802, edition: 14, level: 1, name: "Kavor Skarn" }),
    Object.freeze({ cardDetailId: 784, edition: 14, level: 1, name: "Boring Hobgoblin" }),
    Object.freeze({ cardDetailId: 742, edition: 14, level: 1, name: "Gonach Excavator" }),
    Object.freeze({ cardDetailId: 731, edition: 14, level: 1, name: "Stampeding Calf" }),
    Object.freeze({ cardDetailId: 817, edition: 15, level: 1, name: "Ember Roast Sow" }),
  ]),
} as const);

const FLEET_ACCOUNTS = new Set(["emsenn0", "essiebee", "sigmund-vexler", "marshian", "michael561", "help-fund"]);
const MARKET_ID = /^[a-f0-9]{40}-[0-9]+$/u;
const CARD_UID = /^C[0-9]+-[0-9]+-[A-Z0-9]+$/u;
const NONCE = /^[A-Za-z0-9]{10}$/u;

type JsonRecord = Readonly<Record<string, unknown>>;

function record(value: unknown, field: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Splinterlands ${field} must be an object`);
  return value as JsonRecord;
}

function integer(value: unknown, field: string, minimum = 0): number {
  const parsed = typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`Splinterlands ${field} must be an integer of at least ${minimum}`);
  return parsed;
}

function exactKeys(value: JsonRecord, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

export interface SplinterlandsRosterListing {
  readonly marketId: string;
  readonly uid: string;
  readonly cardDetailId: number;
  readonly edition: number;
  readonly level: number;
  readonly seller: string;
  readonly usdPrice: number;
  readonly expiresAt: string;
}

export interface SplinterlandsRosterPurchasePlan {
  readonly account: "michael561";
  readonly currency: "CREDITS";
  readonly credits: number;
  readonly creditReserve: number;
  readonly listings: readonly SplinterlandsRosterListing[];
  readonly operation: readonly ["custom_json", Readonly<{
    required_auths: readonly ["michael561"];
    required_posting_auths: readonly [];
    id: "sm_market_purchase";
    json: string;
  }>];
}

export function parseSplinterlandsRosterListing(value: unknown, now = new Date()): SplinterlandsRosterListing {
  const row = record(value, "market listing");
  const marketId = String(row["market_id"] ?? "");
  const uid = String(row["uid"] ?? row["card_id"] ?? "");
  const seller = String(row["seller"] ?? "").toLowerCase();
  const usdPrice = Number(row["buy_price"]);
  const expiresAt = String(row["expiration_date"] ?? "");
  if (!MARKET_ID.test(marketId) || !CARD_UID.test(uid)) throw new Error("Splinterlands listing has an invalid market or card id");
  if (!/^[a-z][a-z0-9.-]{2,15}$/u.test(seller) || FLEET_ACCOUNTS.has(seller)) throw new Error("Splinterlands listing seller is missing or belongs to this fleet");
  if (row["type"] !== "SELL" || row["currency"] !== "USD" || row["gold"] !== false || row["foil"] !== 0) throw new Error("Splinterlands listing is not a regular USD sale");
  if (!Number.isFinite(usdPrice) || usdPrice <= 0 || Math.round(usdPrice * 1000) !== usdPrice * 1000) throw new Error("Splinterlands listing price must be a positive exact thousandth of USD");
  const expirationMs = Date.parse(expiresAt);
  if (!Number.isFinite(expirationMs) || expirationMs - now.getTime() < 60_000) throw new Error("Splinterlands listing is expired or too close to expiry");
  return Object.freeze({
    marketId,
    uid,
    cardDetailId: integer(row["card_detail_id"], "listing card detail id", 1),
    edition: integer(row["edition"], "listing edition", 1),
    level: integer(row["level"], "listing level", 1),
    seller,
    usdPrice,
    expiresAt,
  });
}

export function planSplinterlandsRosterPurchase(input: Readonly<{
  account: string;
  creditBalance: number;
  clientVersion: string;
  nonce: string;
  listingsByCard: ReadonlyMap<number, readonly unknown[]>;
  now?: Date;
}>): SplinterlandsRosterPurchasePlan {
  if (input.account !== SPLINTERLANDS_ROSTER_PURCHASE_POLICY.account) throw new Error("Splinterlands roster purchase is hard-bound to michael561");
  if (!Number.isSafeInteger(input.creditBalance) || input.creditBalance < 0) throw new Error("Splinterlands credit balance must be a nonnegative integer");
  if (!/^0\.\d+\.\d+$/u.test(input.clientVersion)) throw new Error("invalid Splinterlands client version");
  if (!NONCE.test(input.nonce)) throw new Error("Splinterlands purchase nonce must be exactly ten alphanumeric characters");
  const now = input.now ?? new Date();
  const listings = SPLINTERLANDS_ROSTER_PURCHASE_POLICY.cards.map((target) => {
    const candidates = (input.listingsByCard.get(target.cardDetailId) ?? [])
      .map((listing) => {
        try { return parseSplinterlandsRosterListing(listing, now); } catch { return null; }
      })
      .filter((listing): listing is SplinterlandsRosterListing => listing !== null)
      .filter((listing) => listing.cardDetailId === target.cardDetailId && listing.edition === target.edition && listing.level === target.level)
      .sort((left, right) => left.usdPrice - right.usdPrice || left.marketId.localeCompare(right.marketId));
    if (!candidates[0]) throw new Error(`no admitted listing exists for ${target.name}`);
    return candidates[0];
  });
  if (new Set(listings.map((listing) => listing.marketId)).size !== listings.length) throw new Error("Splinterlands roster plan contains a duplicate market listing");
  const credits = listings.reduce((sum, listing) => sum + Math.round(listing.usdPrice * 1000), 0);
  if (credits > SPLINTERLANDS_ROSTER_PURCHASE_POLICY.maximumCredits) throw new Error(`Splinterlands roster costs ${credits} credits, above the hard ${SPLINTERLANDS_ROSTER_PURCHASE_POLICY.maximumCredits}-credit ceiling`);
  const creditReserve = input.creditBalance - credits;
  if (creditReserve < SPLINTERLANDS_ROSTER_PURCHASE_POLICY.minimumCreditReserve) throw new Error(`Splinterlands roster would leave fewer than ${SPLINTERLANDS_ROSTER_PURCHASE_POLICY.minimumCreditReserve} credits`);
  const json = JSON.stringify({
    currency: SPLINTERLANDS_ROSTER_PURCHASE_POLICY.currency,
    items: listings.map((listing) => listing.marketId),
    price: credits,
    app: `splinterlands/${input.clientVersion}`,
    n: input.nonce,
  });
  const operation = Object.freeze(["custom_json", Object.freeze({
    required_auths: Object.freeze([SPLINTERLANDS_ROSTER_PURCHASE_POLICY.account]) as readonly ["michael561"],
    required_posting_auths: Object.freeze([]) as readonly [],
    id: "sm_market_purchase",
    json,
  })]) as SplinterlandsRosterPurchasePlan["operation"];
  return Object.freeze({
    account: SPLINTERLANDS_ROSTER_PURCHASE_POLICY.account,
    currency: SPLINTERLANDS_ROSTER_PURCHASE_POLICY.currency,
    credits,
    creditReserve,
    listings: Object.freeze(listings),
    operation,
  });
}

export function assertExactSplinterlandsRosterPurchaseOperation(
  operation: unknown,
  expected: SplinterlandsRosterPurchasePlan,
): void {
  if (!Array.isArray(operation) || operation.length !== 2 || operation[0] !== "custom_json") throw new Error("Splinterlands roster purchase must be one custom_json operation");
  const fields = record(operation[1], "roster operation");
  if (!exactKeys(fields, ["required_auths", "required_posting_auths", "id", "json"])
    || fields["id"] !== "sm_market_purchase"
    || JSON.stringify(fields) !== JSON.stringify(expected.operation[1])) {
    throw new Error("Splinterlands roster purchase operation differs from the live exact-basket plan");
  }
}

export function reconcileSplinterlandsRosterPurchase(input: Readonly<{
  plan: SplinterlandsRosterPurchasePlan;
  beforeCredits: number;
  afterCredits: number;
  beforeUids: readonly string[];
  afterUids: readonly string[];
}>): Readonly<{ confirmed: true; creditsSpent: number; acquiredUids: readonly string[] }> {
  const expectedUids = input.plan.listings.map((listing) => listing.uid);
  if (expectedUids.some((uid) => input.beforeUids.includes(uid))) throw new Error("Splinterlands purchase settlement started with a target UID already owned");
  if (expectedUids.some((uid) => !input.afterUids.includes(uid))) throw new Error("Splinterlands purchase settlement lacks an exact acquired UID");
  const creditsSpent = input.beforeCredits - input.afterCredits;
  if (creditsSpent !== input.plan.credits) throw new Error("Splinterlands purchase credit delta differs from the committed price");
  return Object.freeze({ confirmed: true, creditsSpent, acquiredUids: Object.freeze(expectedUids) });
}

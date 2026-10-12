export interface HashKingsFungibleAsset {
  readonly symbol: "BUDS" | "HKWATER" | "MOTA";
  readonly balance: string;
  readonly precision: number;
}

export interface HashKingsNftAsset {
  readonly id: number;
  readonly type: string;
  readonly name: string;
}

export interface HashKingsRecoveryEvidence {
  readonly account: string;
  readonly observedAt: string;
  readonly providersAgree: boolean;
  readonly domainDisposition: "parked" | "operational" | "unknown";
  readonly fungibles: readonly HashKingsFungibleAsset[];
  readonly nfts: readonly HashKingsNftAsset[];
  readonly actualBuyOrderCounts: Readonly<Record<"BUDS" | "HKWATER" | "MOTA", number>>;
  readonly budsPoolExitSwapHive: string | null;
  readonly ownNftListingCount: number;
  readonly latestNftTradeUnix: number | null;
}

export interface HashKingsRecoveryPolicy {
  readonly minimumDirectRecoverySwapHive: string;
  readonly maximumComparableSaleAgeDays: number;
}

export type HashKingsRecoveryAssessment =
  | {
      readonly kind: "preserve-custody";
      readonly reason: string;
      readonly nftCount: number;
      readonly recentComparableSale: boolean;
    }
  | {
      readonly kind: "review-recovery";
      readonly reason: string;
      readonly nftCount: number;
      readonly recentComparableSale: boolean;
    }
  | { readonly kind: "refuse"; readonly reason: string };

const ACCOUNT = /^(?=.{3,16}$)[a-z](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z](?:[a-z0-9-]*[a-z0-9])?)*$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
const DAY_SECONDS = 86_400;

function scale(precision: number): bigint {
  if (!Number.isSafeInteger(precision) || precision < 0 || precision > 18) {
    throw new Error("HashKings precision must be an integer from 0 through 18");
  }
  return 10n ** BigInt(precision);
}

export function hashKingsDecimalUnits(value: string, precision: number): bigint {
  const match = DECIMAL.exec(value);
  if (!match) throw new Error(`HashKings value '${value}' is not a canonical unsigned decimal`);
  const fraction = match[1] ?? "";
  if (fraction.length > precision) throw new Error(`HashKings value '${value}' exceeds precision ${precision}`);
  const whole = value.split(".")[0] ?? "0";
  return BigInt(whole) * scale(precision) + BigInt((fraction + "0".repeat(precision)).slice(0, precision) || "0");
}

export function hashKingsFormatUnits(value: bigint, precision: number): string {
  if (value < 0n) throw new Error("HashKings amount cannot be negative");
  const factor = scale(precision);
  if (precision === 0) return value.toString();
  return `${value / factor}.${(value % factor).toString().padStart(precision, "0")}`;
}

export function quoteHashKingsBudsPoolExit(
  budsBalance: string,
  baseQuantity: string,
  quoteQuantity: string,
  feeBps = 25,
): string {
  const precision = 8;
  if (!Number.isSafeInteger(feeBps) || feeBps < 0 || feeBps >= 10_000) throw new Error("invalid HashKings pool fee");
  const input = hashKingsDecimalUnits(budsBalance, precision);
  const reserveIn = hashKingsDecimalUnits(baseQuantity, precision);
  const reserveOut = hashKingsDecimalUnits(quoteQuantity, precision);
  if (input <= 0n || reserveIn <= 0n || reserveOut <= 0n) return hashKingsFormatUnits(0n, precision);
  const effectiveInput = input * BigInt(10_000 - feeBps);
  const output = reserveOut * effectiveInput / (reserveIn * 10_000n + effectiveInput);
  return hashKingsFormatUnits(output, precision);
}

function validateEvidence(evidence: HashKingsRecoveryEvidence, policy: HashKingsRecoveryPolicy): void {
  if (!ACCOUNT.test(evidence.account)) throw new Error("invalid HashKings Hive account");
  const observedUnix = Math.floor(Date.parse(evidence.observedAt) / 1000);
  if (!Number.isSafeInteger(observedUnix) || observedUnix <= 0) throw new Error("invalid HashKings observation timestamp");
  if (!Number.isSafeInteger(policy.maximumComparableSaleAgeDays) || policy.maximumComparableSaleAgeDays < 1) {
    throw new Error("invalid HashKings comparable-sale age policy");
  }
  hashKingsDecimalUnits(policy.minimumDirectRecoverySwapHive, 8);
  if (evidence.budsPoolExitSwapHive !== null) hashKingsDecimalUnits(evidence.budsPoolExitSwapHive, 8);
  const expected = new Map<string, number>([["BUDS", 8], ["HKWATER", 4], ["MOTA", 4]]);
  if (evidence.fungibles.length !== expected.size) throw new Error("HashKings fungible inventory is incomplete");
  for (const asset of evidence.fungibles) {
    if (expected.get(asset.symbol) !== asset.precision) throw new Error(`HashKings ${asset.symbol} precision changed`);
    hashKingsDecimalUnits(asset.balance, asset.precision);
    expected.delete(asset.symbol);
  }
  if (expected.size !== 0) throw new Error("HashKings fungible inventory has duplicate or missing symbols");
  if (evidence.nfts.some((asset) => !Number.isSafeInteger(asset.id) || asset.id <= 0 || !asset.type || !asset.name)) {
    throw new Error("HashKings NFT evidence is malformed");
  }
  if (new Set(evidence.nfts.map((asset) => asset.id)).size !== evidence.nfts.length) throw new Error("HashKings NFT identifiers are not unique");
  for (const count of Object.values(evidence.actualBuyOrderCounts)) {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("HashKings buy-order count is malformed");
  }
  if (!Number.isSafeInteger(evidence.ownNftListingCount) || evidence.ownNftListingCount < 0) {
    throw new Error("HashKings own-listing count is malformed");
  }
  if (evidence.latestNftTradeUnix !== null && (!Number.isSafeInteger(evidence.latestNftTradeUnix) || evidence.latestNftTradeUnix <= 0)) {
    throw new Error("HashKings latest-trade timestamp is malformed");
  }
}

export function assessHashKingsRecovery(
  evidence: HashKingsRecoveryEvidence,
  policy: HashKingsRecoveryPolicy = Object.freeze({
    minimumDirectRecoverySwapHive: "0.01000000",
    maximumComparableSaleAgeDays: 90,
  }),
): HashKingsRecoveryAssessment {
  try {
    validateEvidence(evidence, policy);
    if (!evidence.providersAgree) return Object.freeze({ kind: "refuse", reason: "independent Hive-Engine providers disagree" });
    const observedUnix = Math.floor(Date.parse(evidence.observedAt) / 1000);
    const recentComparableSale = evidence.latestNftTradeUnix !== null
      && observedUnix - evidence.latestNftTradeUnix <= policy.maximumComparableSaleAgeDays * DAY_SECONDS
      && observedUnix >= evidence.latestNftTradeUnix;
    const hasActualBid = Object.values(evidence.actualBuyOrderCounts).some((count) => count > 0);
    const poolExitIsMaterial = evidence.budsPoolExitSwapHive !== null
      && hashKingsDecimalUnits(evidence.budsPoolExitSwapHive, 8) >= hashKingsDecimalUnits(policy.minimumDirectRecoverySwapHive, 8);
    if (hasActualBid || poolExitIsMaterial) {
      return Object.freeze({
        kind: "review-recovery",
        reason: hasActualBid
          ? "an actual fungible buy order exists and may support a bounded recovery"
          : "the exact BUDS pool exit meets the direct-recovery threshold",
        nftCount: evidence.nfts.length,
        recentComparableSale,
      });
    }
    if (recentComparableSale && evidence.nfts.length > 0) {
      return Object.freeze({
        kind: "review-recovery",
        reason: "recent independently confirmed NFT sales justify separately pricing a custody-changing listing",
        nftCount: evidence.nfts.length,
        recentComparableSale,
      });
    }
    return Object.freeze({
      kind: "preserve-custody",
      reason: evidence.domainDisposition === "parked"
        ? "the game domain is parked and no material executable bid or recent NFT sale justifies spending authority or market custody"
        : "no material executable bid or recent NFT sale justifies spending authority or market custody",
      nftCount: evidence.nfts.length,
      recentComparableSale,
    });
  } catch (error) {
    return Object.freeze({ kind: "refuse", reason: `invalid HashKings recovery evidence: ${error instanceof Error ? error.message : String(error)}` });
  }
}

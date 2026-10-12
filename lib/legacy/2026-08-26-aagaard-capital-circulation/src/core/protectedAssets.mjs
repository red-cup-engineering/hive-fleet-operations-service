// Assets named here are treasury invariants, not trading inventory.  Keep the
// exact identity in one low-level module so a future game or market adapter
// cannot accidentally widen its own authority around the asset.

export const PROTECTED_HOLOZING_ALPHA_VIAL = Object.freeze({
  account: "michael561",
  chain: "hive-engine",
  symbol: "ZINGALPHA",
  id: "1831",
  policy: "preserve-closed-and-owned",
});

function fail(message) {
  throw new Error(`protected-assets: ${message}`);
}

function scalarId(value) {
  if (typeof value === "string" && /^[1-9][0-9]*$/.test(value)) return value;
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  return null;
}

function idsIn(value) {
  if (Array.isArray(value)) return value.flatMap(idsIn);
  const scalar = scalarId(value);
  if (scalar) return [scalar];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, nested]) => (
    ["id", "_id", "ids", "nftId", "nftIds", "instance", "instances", "nfts"].includes(key)
      ? idsIn(nested)
      : []
  ));
}

function inspectSymbolBearingObjects(value, visitor) {
  if (Array.isArray(value)) {
    for (const nested of value) inspectSymbolBearingObjects(nested, visitor);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Object.hasOwn(value, "symbol")) visitor(value);
  for (const nested of Object.values(value)) inspectSymbolBearingObjects(nested, visitor);
}

/** Refuse any signed Hive-Engine mutation that can name the protected vial.
 * An action naming ZINGALPHA without an instance id is ambiguous and is also
 * refused; the signer must never guess that such an action excludes #1831. */
export function assertNoProtectedAssetMutation({ account, decoded }) {
  if (account !== PROTECTED_HOLOZING_ALPHA_VIAL.account) return;
  inspectSymbolBearingObjects(decoded, (record) => {
    if (record.symbol !== PROTECTED_HOLOZING_ALPHA_VIAL.symbol) return;
    const ids = idsIn(record);
    if (ids.length === 0 || ids.includes(PROTECTED_HOLOZING_ALPHA_VIAL.id)) {
      fail(`${PROTECTED_HOLOZING_ALPHA_VIAL.symbol} #${PROTECTED_HOLOZING_ALPHA_VIAL.id} is permanently excluded from open, transfer, delegate, list, sell, burn, and liquidation authority`);
    }
  });
}

/** A fungible-token liquidation runner must refuse the NFT symbol even if a
 * provider ever exposes a confusing or malformed token-table row for it. */
export function assertLiquidationSymbolAllowed(account, symbol) {
  if (account === PROTECTED_HOLOZING_ALPHA_VIAL.account
    && symbol === PROTECTED_HOLOZING_ALPHA_VIAL.symbol) {
    fail(`${symbol} #${PROTECTED_HOLOZING_ALPHA_VIAL.id} is protected treasury inventory, not liquidatable inventory`);
  }
}

/** The public inventory read is also a custody alarm.  A reward/game cycle for
 * michael561 fails closed if the protected vial disappears from the official
 * HoloZing inventory instead of silently continuing from stale assumptions. */
export function assertProtectedAlphaVialObserved(account, alphaVialIds) {
  if (account !== PROTECTED_HOLOZING_ALPHA_VIAL.account) return;
  const ids = alphaVialIds.map(scalarId).filter(Boolean);
  if (!ids.includes(PROTECTED_HOLOZING_ALPHA_VIAL.id)) {
    fail(`official HoloZing inventory does not contain protected ${PROTECTED_HOLOZING_ALPHA_VIAL.symbol} #${PROTECTED_HOLOZING_ALPHA_VIAL.id}`);
  }
}

/** HoloZing vial opening is an off-chain API act before its on-chain effects,
 * so it needs a guard in addition to the Hive signing bridge. */
export function assertHoloZingApiMutationAllowed(path, body) {
  const normalizedPath = String(path).toLowerCase();
  const isOpeningRoute = normalizedPath.includes("packopen")
    && !normalizedPath.includes("inventory");
  const namesVial = idsIn(body).includes(PROTECTED_HOLOZING_ALPHA_VIAL.id);
  if (isOpeningRoute || namesVial) {
    fail(`HoloZing API mutation may not open or consume ${PROTECTED_HOLOZING_ALPHA_VIAL.symbol} #${PROTECTED_HOLOZING_ALPHA_VIAL.id}`);
  }
}

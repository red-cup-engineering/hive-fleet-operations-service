// integrations/hive-engine/hiveEngineOps — real Hive-Engine contract-call
// encoding, verified against the actual open-source contract sources
// (github.com/hive-engine/hivesmartcontracts: contracts/market.js,
// contracts/tokens.js, contracts/marketpools.js — checked at commit time
// via GitHub's API, not assumed from memory of the protocol) and, where
// possible, against real on-chain transactions this fleet's own accounts
// have already broadcast (help-fund's real marketSell and addLiquidity
// calls, essiebee's real unstake/transfer calls).
//
// Every action here requires the account's ACTIVE key on-chain
// (isSignedWithActiveKey === true in the contract source) -- this is not
// a convention this codebase invented, it is what the contract itself
// asserts and refuses without.
//
// This module only ENCODES operations. It broadcasts nothing itself; the
// resulting custom_json operation is handed to whatever signs and
// broadcasts (see scripts/hive-broadcast.mjs).

const CONTRACT_ID = "ssc-mainnet-hive";

function customJsonOp(account, contractName, contractAction, contractPayload) {
  return Object.freeze(["custom_json", Object.freeze({
    id: CONTRACT_ID,
    required_auths: Object.freeze([account]),
    required_posting_auths: Object.freeze([]),
    json: JSON.stringify({ contractName, contractAction, contractPayload }),
  })]);
}

/** Buy `symbol` at market, spending `quantityHive` SWAP.HIVE. Verified
 *  against market.js actions.marketBuy: payload {symbol, quantity}, where
 *  quantity is denominated in SWAP.HIVE (the contract asserts
 *  symbol !== 'SWAP.HIVE'). */
export function marketBuy(account, symbol, quantityHive) {
  return customJsonOp(account, "market", "marketBuy", { symbol, quantity: quantityHive });
}

/** Sell `quantity` of `symbol` at market for SWAP.HIVE. Verified against
 *  market.js actions.marketSell and against help-fund's own real
 *  broadcast history (marketSell on TOOFUCKEH). */
export function marketSell(account, symbol, quantity) {
  return customJsonOp(account, "market", "marketSell", { symbol, quantity });
}

/** Stake `quantity` of `symbol` to `to` (an account name; use the same
 *  account to self-stake). Verified against tokens.js actions.stake. */
export function stake(account, symbol, quantity, to = account) {
  return customJsonOp(account, "tokens", "stake", { symbol, to, quantity });
}

/** Unstake `quantity` of `symbol` (begins the cooldown). Verified against
 *  tokens.js actions.unstake and against essiebee's own real broadcast
 *  history (unstake on SPORTS, ARCHON). */
export function unstake(account, symbol, quantity) {
  return customJsonOp(account, "tokens", "unstake", { symbol, quantity });
}

/** Delegate `quantity` of staked `symbol` to `to`. Verified against
 *  tokens.js actions.delegate. */
export function delegate(account, symbol, quantity, to) {
  return customJsonOp(account, "tokens", "delegate", { symbol, to, quantity });
}

/** Add liquidity to a pool, e.g. tokenPair "SWAP.HIVE:DEC", supplying
 *  baseQuantity of the pair's first token and quoteQuantity of its
 *  second, at (approximately) the pool's current ratio. Verified against
 *  marketpools.js actions.addLiquidity and against help-fund's own real
 *  broadcast history (three real addLiquidity calls). */
export function addLiquidity(account, tokenPair, baseQuantity, quoteQuantity) {
  return customJsonOp(account, "marketpools", "addLiquidity", { tokenPair, baseQuantity, quoteQuantity });
}

/** Remove `sharesPercent` (0 < x <= 100, at most 3 decimal places) of the
 *  account's LP position in tokenPair. Verified against
 *  marketpools.js actions.removeLiquidity. */
export function removeLiquidity(account, tokenPair, sharesPercent) {
  return customJsonOp(account, "marketpools", "removeLiquidity", { tokenPair, sharesOut: sharesPercent });
}

/** Swap tokenAmount of tokenSymbol through the pool tokenPair.
 *  tradeType "exactInput" (tokenAmount is what you're spending;
 *  minAmountOut optionally bounds slippage) or "exactOutput" (tokenAmount
 *  is what you want to receive; maxAmountIn optionally bounds it).
 *  Verified against marketpools.js actions.swapTokens (TradeType enum). */
export function swapTokens(account, tokenPair, tokenSymbol, tokenAmount, tradeType, bound) {
  if (tradeType !== "exactInput" && tradeType !== "exactOutput") {
    throw new Error(`swapTokens: tradeType must be 'exactInput' or 'exactOutput', got '${tradeType}'`);
  }
  const payload = { tokenPair, tokenSymbol, tokenAmount, tradeType };
  if (bound !== undefined) {
    if (tradeType === "exactInput") payload.minAmountOut = bound;
    else payload.maxAmountIn = bound;
  }
  return customJsonOp(account, "marketpools", "swapTokens", payload);
}

// The HIVE<->SWAP.HIVE peg is a real, separate mechanism from every
// custom_json contract call above: verified directly against the LIVE
// deployed hivepegged contract (api.hive-engine.com/rpc/contracts
// getContract "hivepegged" -> owner: "honey-swap"), cross-checked against
// hivesmartcontracts/contracts/hivepegged.js, and confirmed end-to-end
// against a real, recent on-chain deposit (suara8's 0.398 HIVE transfer to
// honey-swap on 2026-07-18, memo exactly matching WRAP_MEMO below, credited
// 0.395 SWAP.HIVE -- the 0.75% fee, min 0.001, matches the contract's own
// fee formula exactly).
export const HONEY_SWAP_ACCOUNT = "honey-swap";
export const WRAP_MEMO = JSON.stringify({ id: CONTRACT_ID, json: { contractName: "hivepegged", contractAction: "buy", contractPayload: {} } });

/** Deposit `quantityHive` (a plain decimal string, e.g. "1.234") of real
 *  HIVE to mint SWAP.HIVE. This is a NATIVE Hive `transfer` operation, not
 *  a Hive-Engine custom_json call -- it requires the account's active key
 *  (transfer requires active authority on Hive itself) and moves real HIVE
 *  to honey-swap's own real Hive account. The sidechain observes the
 *  transfer (matched by amount, sender, and this exact memo) and mints
 *  SWAP.HIVE minus a ~0.75% fee (minimum 0.001) to the sender. */
export function wrapHive(account, quantityHive) {
  return Object.freeze(["transfer", Object.freeze({
    from: account,
    to: HONEY_SWAP_ACCOUNT,
    amount: `${quantityHive} HIVE`,
    memo: WRAP_MEMO,
  })]);
}

/** Withdraw `quantity` of held SWAP.HIVE back to real HIVE. Verified
 *  against the live hivepegged contract's actions.withdraw: payload
 *  {quantity, isSignedWithActiveKey} (quantity at most 3 decimal places,
 *  minimum 0.002) -- internally transfers the SWAP.HIVE to honey-swap and
 *  registers a withdrawal record; honey-swap's own off-chain process later
 *  sends real HIVE back, minus the same ~0.75% fee (minimum 0.001). */
export function unwrapHive(account, quantity) {
  return customJsonOp(account, "hivepegged", "withdraw", { quantity });
}

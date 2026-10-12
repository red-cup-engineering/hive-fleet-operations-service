// Pure confirmation of one arbitrage leg. An outer Hive transaction id is not an economic
// effect: a leg is confirmed only when its sidechain transaction ran the admitted contract action
// without errors and the account's own token-transfer events prove the exact quantity moved within
// its committed SWAP.HIVE bound. Amounts stay integer units; a float never decides an effect.
import { decimalUnits, formatUnits } from "@red-cup-engineering/exact-number-data-service/decimal-string";
import { transactionLogs } from "@red-cup-engineering/hive-blockchain-client-service/engine.mjs";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function eventsOf(row) {
  return transactionLogs(row).events;
}

function errorsOf(row) {
  return transactionLogs(row).errors;
}

const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/u;

function scale(precision) { return 10n ** BigInt(precision); }

function units(value, precision) {
  try { return decimalUnits(String(value ?? ""), precision); } catch { return null; }
}

function amount(events, predicate, precision) {
  return events.reduce((sum, event) => {
    const data = record(event.data);
    if (!predicate(event, data)) return sum;
    const quantity = units(data.quantity, precision);
    return quantity === null ? sum : sum + quantity;
  }, 0n);
}

function inbound(events, account, symbol, precision) {
  return amount(events, (event, data) => event.contract === "tokens"
    && event.event === "transferFromContract" && data.to === account && data.symbol === symbol, precision);
}

function outbound(events, account, symbol, precision) {
  return amount(events, (event, data) => event.contract === "tokens"
    && event.event === "transferToContract" && data.from === account && data.symbol === symbol, precision);
}

function callKey(call) {
  return `${call?.contractName}.${call?.contractAction}`;
}

function rowMatches(row, call, account) {
  if (!row || row.sender !== account || row.contract !== call?.contractName || row.action !== call?.contractAction) return false;
  let payload;
  try { payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload; }
  catch { return false; }
  return payload && Object.entries(call.contractPayload ?? {}).every(([key, value]) => payload[key] === value);
}

function closesOrder(events, account, type, txid) {
  return typeof txid === "string" && events.some((event) => {
    const data = record(event.data);
    return event.contract === "market" && event.event === "orderClosed"
      && data.account === account && data.type === type && data.txId === txid;
  });
}

/**
 * Confirms one standalone `marketpools.swapTokens` (exactOutput) leg,
 * broadcast alone (2026-09-05: no longer bundled with its paired sell, so a
 * Hive-Engine resourcemanager multi-transaction BEED fee never applies) --
 * the account's own transfer events must show it received exactly the
 * committed output quantity and spent no more than the committed
 * `maxAmountIn` SWAP.HIVE.
 * @param {string} account
 * @param {Readonly<Record<string, unknown>>} call the single swapTokens call this leg's own operation carried
 * @param {readonly Readonly<Record<string, unknown>>[]} rows the getTransactionInfo rows for this leg's own transaction id (expected length 1)
 * @returns {Readonly<Record<string, unknown>>}
 */
export function assessSwapLegEffect(account, call, rows) {
  const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (callKey(call) !== "marketpools.swapTokens" || !row) {
    return Object.freeze({ status: "unverified", source: "hive-engine.getTransactionInfo", expectedLegs: 1, confirmedLegs: 0 });
  }
  const payload = record(call.contractPayload);
  const symbol = String(payload.tokenSymbol ?? "");
  const quantityText = String(payload.tokenAmount ?? "");
  const quantityPrecision = DECIMAL.exec(quantityText)?.[1]?.length ?? 0;
  const expectedQuantity = units(quantityText, quantityPrecision);
  const maxInput = units(payload.maxAmountIn, 8);
  if (!symbol || expectedQuantity === null || expectedQuantity <= 0n || maxInput === null || maxInput <= 0n) {
    return Object.freeze({ status: "not-recognized", source: "hive-engine.getTransactionInfo", expectedLegs: 1, confirmedLegs: 0 });
  }
  const events = eventsOf(row);
  const recognized = rowMatches(row, call, account) && errorsOf(row).length === 0;
  const acquired = inbound(events, account, symbol, quantityPrecision) - outbound(events, account, symbol, quantityPrecision);
  const input = outbound(events, account, "SWAP.HIVE", 8) - inbound(events, account, "SWAP.HIVE", 8);
  const confirmed = recognized && acquired === expectedQuantity && input > 0n && maxInput >= input;
  const common = {
    source: "hive-engine.getTransactionInfo", reference: typeof row.transactionId === "string" ? row.transactionId : "",
    contract: call.contractName, action: call.contractAction, expectedLegs: 1, confirmedLegs: Number(confirmed),
    realizedInputSwapHive: formatUnits(input, 8), realizedAcquiredQuantity: formatUnits(acquired, quantityPrecision), acquiredSymbol: symbol,
  };
  if (confirmed) return Object.freeze({ status: "confirmed", ...common });
  return Object.freeze({ status: "partial", ...common });
}

/**
 * Confirms one standalone `market.sell` leg -- either the round trip's own
 * leg two, or a reconciliation sell closing out a residue position. The
 * account's own transfer events must show it disposed exactly the committed
 * quantity and realized proceeds at or above the committed limit price, and
 * the market's own `orderClosed` event must name this transaction.
 * @param {string} account
 * @param {Readonly<Record<string, unknown>>} call the single sell call this leg's own operation carried
 * @param {readonly Readonly<Record<string, unknown>>[]} rows the getTransactionInfo rows for this leg's own transaction id (expected length 1)
 * @returns {Readonly<Record<string, unknown>>}
 */
export function assessSellLegEffect(account, call, rows) {
  const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (callKey(call) !== "market.sell" || !row) {
    return Object.freeze({ status: "unverified", source: "hive-engine.getTransactionInfo", expectedLegs: 1, confirmedLegs: 0 });
  }
  const payload = record(call.contractPayload);
  const symbol = String(payload.symbol ?? "");
  const quantityText = String(payload.quantity ?? "");
  const quantityPrecision = DECIMAL.exec(quantityText)?.[1]?.length ?? 0;
  const expectedQuantity = units(quantityText, quantityPrecision);
  const price = units(payload.price, 8);
  const boundProceeds = expectedQuantity !== null && price !== null ? expectedQuantity * price / scale(quantityPrecision) : null;
  if (!symbol || expectedQuantity === null || expectedQuantity <= 0n || boundProceeds === null || boundProceeds <= 0n) {
    return Object.freeze({ status: "not-recognized", source: "hive-engine.getTransactionInfo", expectedLegs: 1, confirmedLegs: 0 });
  }
  const events = eventsOf(row);
  const recognized = rowMatches(row, call, account) && errorsOf(row).length === 0;
  const disposed = outbound(events, account, symbol, quantityPrecision) - inbound(events, account, symbol, quantityPrecision);
  const proceeds = inbound(events, account, "SWAP.HIVE", 8) - outbound(events, account, "SWAP.HIVE", 8);
  const orderClosed = closesOrder(events, account, "sell", row.transactionId);
  const confirmed = recognized && disposed === expectedQuantity && proceeds >= boundProceeds && orderClosed;
  const common = {
    source: "hive-engine.getTransactionInfo", reference: typeof row.transactionId === "string" ? row.transactionId : "",
    contract: call.contractName, action: call.contractAction, expectedLegs: 1, confirmedLegs: Number(confirmed),
    realizedProceedsSwapHive: formatUnits(proceeds, 8), realizedDisposedQuantity: formatUnits(disposed, quantityPrecision), disposedSymbol: symbol,
  };
  if (confirmed) return Object.freeze({ status: "confirmed", ...common });
  return Object.freeze({ status: "partial", ...common });
}

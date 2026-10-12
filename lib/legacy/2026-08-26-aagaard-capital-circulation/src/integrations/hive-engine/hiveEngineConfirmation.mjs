// Pure confirmation law for Aagaard's two-leg Hive-Engine bundles.
// An outer Hive transaction id is not an economic effect. A bundle is
// confirmed only when both sidechain transactions match the admitted
// contract actions and their token-transfer events prove the exact token
// round trip plus bounded SWAP.HIVE input/proceeds.  Amounts stay as integer
// units; a binary float must never decide whether an economic effect exists.

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function logsOf(row) {
  if (!row) return {};
  try {
    return typeof row.logs === "string" ? record(JSON.parse(row.logs)) : record(row.logs);
  } catch {
    return {};
  }
}

function eventsOf(row) {
  const events = logsOf(row).events;
  return Array.isArray(events) ? events.map(record) : [];
}

function errorsOf(row) {
  const errors = logsOf(row).errors;
  return Array.isArray(errors) ? errors : [];
}

const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/u;

function scale(precision) { return 10n ** BigInt(precision); }

function units(value, precision) {
  const text = String(value ?? "");
  const match = DECIMAL.exec(text);
  if (!match || (match[1]?.length ?? 0) > precision) return null;
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * scale(precision) + BigInt((fraction + "0".repeat(precision)).slice(0, precision) || "0");
}

function render(value, precision) {
  if (value < 0n) return `-${render(-value, precision)}`;
  const whole = value / scale(precision); const fraction = (value % scale(precision)).toString().padStart(precision, "0");
  return `${whole}.${fraction}`;
}

const BEED_FEE_UNITS = 10n, BEED_FEE_NODES = ["https://api.hive-engine.com/rpc/contracts", "https://herpc.dtools.dev/contracts"];
function feeMark(state) { const balance = units(state.balance, 4); if (balance === null || balance < BEED_FEE_UNITS) return null;
  let remaining = BEED_FEE_UNITS, value = 0n, prior = null; for (const bid of state.bids) { const quantity = units(bid.quantity, 4), price = units(bid.price, 8); if (quantity === null || price === null || quantity <= 0n || price <= 0n || (prior !== null && price > prior)) return null; const take = quantity < remaining ? quantity : remaining; value += take * price / 10_000n; remaining -= take; prior = price; if (remaining === 0n) return value; } return null; }
export function assessBeedFeeWitness({ worstCaseProfitSwapHive, states }) { const profit = units(worstCaseProfitSwapHive, 8); if (profit === null || !Array.isArray(states) || states.length < 2 || JSON.stringify(states[0]) !== JSON.stringify(states[1])) return Object.freeze({ status: "unpriced-resource-cost-model" }); const cost = feeMark(states[0]); if (cost === null || profit < cost + 100_000n) return Object.freeze({ status: "unpriced-resource-cost-model" }); return Object.freeze({ status: "witnessed-net-cost", totalSwapHive: render(cost, 8), resources: Object.freeze(["Hive Engine BEED market fee", "Hive RC", "signer", "runner/paymaster"]), source: "two-provider-executable-BEED-bid-depth" }); }
export async function observeBeedFeeWitness({ account, worstCaseProfitSwapHive }) { const state = await Promise.all(BEED_FEE_NODES.map(async (node) => { const find = async (params) => { const response = await fetch(node, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "find", params }), signal: AbortSignal.timeout(15_000) }); const body = await response.json(); if (!response.ok || body?.error || !Array.isArray(body?.result)) throw new Error("BEED fee evidence unavailable"); return body.result; }; const [balances, bids] = await Promise.all([find({ contract: "tokens", table: "balances", query: { account, symbol: "BEED" }, limit: 2, offset: 0, indexes: [] }), find({ contract: "market", table: "buyBook", query: { symbol: "BEED" }, limit: 200, offset: 0, indexes: [{ index: "priceDec", descending: true }] })]); if (balances.length > 1) throw new Error("BEED balance ambiguous"); return Object.freeze({ balance: String(balances[0]?.balance ?? "0.0000"), bids: Object.freeze(bids.map((row) => Object.freeze({ quantity: String(row.quantity), price: String(row.price) }))) }); })); return assessBeedFeeWitness({ worstCaseProfitSwapHive, states: state }); }

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

function rowMatches(row, call) {
  return row && row.contract === call?.contractName && row.action === call?.contractAction;
}

function closesOrder(events, account, type, txid) {
  return typeof txid === "string" && events.some((event) => {
    const data = record(event.data);
    return event.contract === "market" && event.event === "orderClosed"
      && data.account === account && data.type === type && data.txId === txid;
  });
}

export function assessRoundTripEconomicEffect(account, calls, rows) {
  if (!Array.isArray(calls) || calls.length !== 2 || !Array.isArray(rows) || rows.length !== 2) {
    return Object.freeze({ status: "unverified", source: "hive-engine.getTransactionInfo", expectedLegs: 2, confirmedLegs: 0 });
  }
  const [firstCall, secondCall] = calls;
  const [firstRow, secondRow] = rows;
  const poolToBook = callKey(firstCall) === "marketpools.swapTokens" && callKey(secondCall) === "market.sell";
  const bookToPool = callKey(firstCall) === "market.buy" && callKey(secondCall) === "marketpools.swapTokens";
  if (!poolToBook && !bookToPool) {
    return Object.freeze({ status: "not-recognized", source: "hive-engine.getTransactionInfo", expectedLegs: 2, confirmedLegs: 0 });
  }
  const acquisitionCall = firstCall;
  const exitCall = secondCall;
  const acquisitionPayload = record(acquisitionCall.contractPayload);
  const exitPayload = record(exitCall.contractPayload);
  const symbol = String(poolToBook ? acquisitionPayload.tokenSymbol : acquisitionPayload.symbol);
  const quantityText = String(poolToBook ? acquisitionPayload.tokenAmount : acquisitionPayload.quantity ?? "");
  const quantityPrecision = DECIMAL.exec(quantityText)?.[1]?.length ?? 0;
  const expectedQuantity = units(quantityText, quantityPrecision);
  const price = poolToBook ? units(exitPayload.price, 8) : units(acquisitionPayload.price, 8);
  const directBound = poolToBook ? null : units(exitPayload.minAmountOut, 8);
  const maxInput = poolToBook ? units(acquisitionPayload.maxAmountIn, 8) : expectedQuantity !== null && price !== null
    ? expectedQuantity * price / scale(quantityPrecision) : null;
  const boundProceeds = poolToBook && expectedQuantity !== null && price !== null
    ? expectedQuantity * price / scale(quantityPrecision) : directBound;
  if (!symbol || expectedQuantity === null || expectedQuantity <= 0n
    || boundProceeds === null || boundProceeds <= 0n
    || maxInput === null || maxInput <= 0n) {
    return Object.freeze({ status: "not-recognized", source: "hive-engine.getTransactionInfo", expectedLegs: 2, confirmedLegs: 0 });
  }

  const firstEvents = eventsOf(firstRow);
  const secondEvents = eventsOf(secondRow);
  const firstRecognized = rowMatches(firstRow, firstCall) && errorsOf(firstRow).length === 0;
  const secondRecognized = rowMatches(secondRow, secondCall) && errorsOf(secondRow).length === 0;
  const acquired = inbound(firstEvents, account, symbol, quantityPrecision) - outbound(firstEvents, account, symbol, quantityPrecision);
  const disposed = outbound(secondEvents, account, symbol, quantityPrecision) - inbound(secondEvents, account, symbol, quantityPrecision);
  const input = outbound(firstEvents, account, "SWAP.HIVE", 8) - inbound(firstEvents, account, "SWAP.HIVE", 8);
  const proceeds = inbound(secondEvents, account, "SWAP.HIVE", 8) - outbound(secondEvents, account, "SWAP.HIVE", 8);
  // Market orders can burn BEED through Hive Engine's resource manager.  It
  // is a separately denominated resource loss, never something SWAP.HIVE
  // gross proceeds may silently absorb.
  const feeBeed = outbound(secondEvents, account, "BEED", 4) - inbound(secondEvents, account, "BEED", 4);
  const orderEvents = poolToBook ? secondEvents : firstEvents;
  const orderRow = poolToBook ? secondRow : firstRow;
  const orderClosed = closesOrder(orderEvents, account, poolToBook ? "sell" : "buy", orderRow?.transactionId);
  const firstConfirmed = firstRecognized && acquired === expectedQuantity && input > 0n && maxInput >= input
    && (poolToBook || orderClosed);
  const secondConfirmed = secondRecognized && disposed === expectedQuantity && proceeds >= boundProceeds
    && (bookToPool || orderClosed);
  const confirmedLegs = Number(firstConfirmed) + Number(secondConfirmed);
  const reference = rows.map((row) => row?.transactionId).filter((id) => typeof id === "string").join(",");
  const common = {
    source: "hive-engine.getTransactionInfo",
    reference,
    contract: `${firstCall.contractName}+${secondCall.contractName}`,
    action: `${firstCall.contractAction}+${secondCall.contractAction}`,
    expectedLegs: 2,
    confirmedLegs,
    realizedInputSwapHive: render(input, 8),
    realizedProceedsSwapHive: render(proceeds, 8),
    realizedGrossDeltaSwapHive: render(proceeds - input, 8),
    realizedFeeBeed: render(feeBeed, 4),
    // Net P&L is intentionally absent: Hive RC, signing and paymaster
    // resources have not yet been valued by a witnessed common cost model.
    unpricedResourceCosts: true,
  };
  if (firstConfirmed && secondConfirmed) return Object.freeze({ status: "confirmed", ...common });
  if (firstRow || secondRow) return Object.freeze({ status: "partial", ...common });
  return Object.freeze({ status: "unverified", ...common });
}

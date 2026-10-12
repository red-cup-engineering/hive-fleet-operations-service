// Pure confirmation law for Aagaard's two-leg Hive-Engine bundles.
// An outer Hive transaction id is not an economic effect. A bundle is
// confirmed only when both sidechain transactions match the admitted
// contract actions and their token-transfer events prove the exact token
// round trip plus bounded SWAP.HIVE input/proceeds.

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

function amount(events, predicate) {
  return events.reduce((sum, event) => {
    const data = record(event.data);
    if (!predicate(event, data)) return sum;
    const quantity = Number(data.quantity);
    return Number.isFinite(quantity) ? sum + quantity : sum;
  }, 0);
}

function inbound(events, account, symbol) {
  return amount(events, (event, data) => event.contract === "tokens"
    && event.event === "transferFromContract" && data.to === account && data.symbol === symbol);
}

function outbound(events, account, symbol) {
  return amount(events, (event, data) => event.contract === "tokens"
    && event.event === "transferToContract" && data.from === account && data.symbol === symbol);
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

function nearAtLeast(actual, expected) {
  return actual + 1e-10 >= expected;
}

function nearEqual(actual, expected) {
  return Math.abs(actual - expected) <= Math.max(1e-10, Math.abs(expected) * 1e-10);
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
  const expectedQuantity = Number(poolToBook ? acquisitionPayload.tokenAmount : acquisitionPayload.quantity);
  const boundProceeds = poolToBook
    ? Number(exitPayload.price) * expectedQuantity
    : Number(exitPayload.minAmountOut);
  const maxInput = poolToBook ? Number(acquisitionPayload.maxAmountIn) : Number(acquisitionPayload.price) * expectedQuantity;
  if (!symbol || !Number.isFinite(expectedQuantity) || expectedQuantity <= 0
    || !Number.isFinite(boundProceeds) || boundProceeds <= 0
    || !Number.isFinite(maxInput) || maxInput <= 0) {
    return Object.freeze({ status: "not-recognized", source: "hive-engine.getTransactionInfo", expectedLegs: 2, confirmedLegs: 0 });
  }

  const firstEvents = eventsOf(firstRow);
  const secondEvents = eventsOf(secondRow);
  const firstRecognized = rowMatches(firstRow, firstCall) && errorsOf(firstRow).length === 0;
  const secondRecognized = rowMatches(secondRow, secondCall) && errorsOf(secondRow).length === 0;
  const acquired = Math.max(0, inbound(firstEvents, account, symbol) - outbound(firstEvents, account, symbol));
  const disposed = Math.max(0, outbound(secondEvents, account, symbol) - inbound(secondEvents, account, symbol));
  const input = Math.max(0, outbound(firstEvents, account, "SWAP.HIVE") - inbound(firstEvents, account, "SWAP.HIVE"));
  const proceeds = Math.max(0, inbound(secondEvents, account, "SWAP.HIVE") - outbound(secondEvents, account, "SWAP.HIVE"));
  const orderEvents = poolToBook ? secondEvents : firstEvents;
  const orderRow = poolToBook ? secondRow : firstRow;
  const orderClosed = closesOrder(orderEvents, account, poolToBook ? "sell" : "buy", orderRow?.transactionId);
  const firstConfirmed = firstRecognized && nearEqual(acquired, expectedQuantity) && input > 0 && nearAtLeast(maxInput, input)
    && (poolToBook || orderClosed);
  const secondConfirmed = secondRecognized && nearEqual(disposed, expectedQuantity) && nearAtLeast(proceeds, boundProceeds)
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
    realizedInputSwapHive: Number(input.toFixed(8)),
    realizedProceedsSwapHive: Number(proceeds.toFixed(8)),
    realizedPnlSwapHive: Number((proceeds - input).toFixed(8)),
  };
  if (firstConfirmed && secondConfirmed) return Object.freeze({ status: "confirmed", ...common });
  if (firstRow || secondRow) return Object.freeze({ status: "partial", ...common });
  return Object.freeze({ status: "unverified", ...common });
}

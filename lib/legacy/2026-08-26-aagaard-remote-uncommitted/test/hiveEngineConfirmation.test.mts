import assert from "node:assert/strict";
import test from "node:test";

import { assessRoundTripEconomicEffect } from "../src/integrations/hive-engine/hiveEngineConfirmation.mjs";

const account = "profit-witness";

function row(transactionId: string, contract: string, action: string, events: readonly unknown[], errors: readonly string[] = []) {
  return { transactionId, contract, action, logs: JSON.stringify({ events, errors }) };
}

function transfer(event: "transferToContract" | "transferFromContract", data: Record<string, string>) {
  return { contract: "tokens", event, data };
}

function orderClosed(type: "buy" | "sell", txId: string) {
  return { contract: "market", event: "orderClosed", data: { account, type, txId } };
}

test("confirms pool-to-book only from the exact round trip and bounded net proceeds", () => {
  const calls = [
    { contractName: "marketpools", contractAction: "swapTokens", contractPayload: { tokenPair: "SWAP.HIVE:LEN", tokenSymbol: "LEN", tokenAmount: "10.000", tradeType: "exactOutput", maxAmountIn: "0.01100000" } },
    { contractName: "market", contractAction: "sell", contractPayload: { symbol: "LEN", quantity: "10.000", price: "0.00120000", expiration: 300 } },
  ];
  const rows = [
    row("outer-0", "marketpools", "swapTokens", [
      transfer("transferToContract", { from: account, to: "marketpools", symbol: "SWAP.HIVE", quantity: "0.01050000" }),
      transfer("transferFromContract", { from: "marketpools", to: account, symbol: "LEN", quantity: "10.000" }),
    ]),
    row("outer-1", "market", "sell", [
      transfer("transferToContract", { from: account, to: "market", symbol: "LEN", quantity: "10.000" }),
      transfer("transferFromContract", { from: "market", to: account, symbol: "SWAP.HIVE", quantity: "0.01200000" }),
      orderClosed("sell", "outer-1"),
    ]),
  ];

  const effect = assessRoundTripEconomicEffect(account, calls, rows);
  assert.equal(effect.status, "confirmed");
  assert.equal(effect.confirmedLegs, 2);
  assert.equal(effect.realizedInputSwapHive, 0.0105);
  assert.equal(effect.realizedProceedsSwapHive, 0.012);
  assert.equal(effect.realizedPnlSwapHive, 0.0015);
});

test("confirms book-to-pool using the market cost and exact-input pool exit", () => {
  const calls = [
    { contractName: "market", contractAction: "buy", contractPayload: { symbol: "LEN", quantity: "10.000", price: "0.00100000", expiration: 300 } },
    { contractName: "marketpools", contractAction: "swapTokens", contractPayload: { tokenPair: "SWAP.HIVE:LEN", tokenSymbol: "LEN", tokenAmount: "10.000", tradeType: "exactInput", minAmountOut: "0.01050000" } },
  ];
  const rows = [
    row("outer-0", "market", "buy", [
      transfer("transferToContract", { from: account, to: "market", symbol: "SWAP.HIVE", quantity: "0.01000000" }),
      transfer("transferFromContract", { from: "market", to: account, symbol: "LEN", quantity: "10.000" }),
      orderClosed("buy", "outer-0"),
    ]),
    row("outer-1", "marketpools", "swapTokens", [
      transfer("transferToContract", { from: account, to: "marketpools", symbol: "LEN", quantity: "10.000" }),
      transfer("transferFromContract", { from: "marketpools", to: account, symbol: "SWAP.HIVE", quantity: "0.01100000" }),
    ]),
  ];

  const effect = assessRoundTripEconomicEffect(account, calls, rows);
  assert.equal(effect.status, "confirmed");
  assert.equal(effect.confirmedLegs, 2);
  assert.equal(effect.realizedPnlSwapHive, 0.001);
});

test("reports partial when full escrow and enough proceeds do not prove the order closed", () => {
  const calls = [
    { contractName: "marketpools", contractAction: "swapTokens", contractPayload: { tokenPair: "SWAP.HIVE:LEN", tokenSymbol: "LEN", tokenAmount: "10.000", tradeType: "exactOutput", maxAmountIn: "0.01100000" } },
    { contractName: "market", contractAction: "sell", contractPayload: { symbol: "LEN", quantity: "10.000", price: "0.00120000", expiration: 300 } },
  ];
  const rows = [
    row("outer-0", "marketpools", "swapTokens", [
      transfer("transferToContract", { from: account, to: "marketpools", symbol: "SWAP.HIVE", quantity: "0.01050000" }),
      transfer("transferFromContract", { from: "marketpools", to: account, symbol: "LEN", quantity: "10.000" }),
    ]),
    row("outer-1", "market", "sell", [
      transfer("transferToContract", { from: account, to: "market", symbol: "LEN", quantity: "10.000" }),
      transfer("transferFromContract", { from: "market", to: account, symbol: "SWAP.HIVE", quantity: "0.01200000" }),
    ]),
  ];

  const effect = assessRoundTripEconomicEffect(account, calls, rows);
  assert.equal(effect.status, "partial");
  assert.equal(effect.confirmedLegs, 1);
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  PROTECTED_HOLOZING_ALPHA_VIAL,
  assertHoloZingApiMutationAllowed,
  assertLiquidationSymbolAllowed,
  assertNoProtectedAssetMutation,
  assertProtectedAlphaVialObserved,
} from "../src/core/protectedAssets.mjs";
import { parseOptions as parseLiquidationOptions } from "../scripts/liquidate-token.mjs";

test("the HoloZing Alpha Vial is an exact permanent treasury invariant", () => {
  assert.deepEqual(PROTECTED_HOLOZING_ALPHA_VIAL, {
    account: "michael561",
    chain: "hive-engine",
    symbol: "ZINGALPHA",
    id: "1831",
    policy: "preserve-closed-and-owned",
  });
  assert.doesNotThrow(() => assertProtectedAlphaVialObserved("michael561", [1831]));
  assert.throws(() => assertProtectedAlphaVialObserved("michael561", []), /does not contain protected ZINGALPHA #1831/);
});

test("every known disposal carrier refuses protected ZINGALPHA #1831", () => {
  const mutations = [
    { contractName: "nft", contractAction: "transfer", contractPayload: { to: "buyer", nfts: [{ symbol: "ZINGALPHA", ids: ["1831"] }] } },
    { contractName: "nft", contractAction: "burn", contractPayload: { symbol: "ZINGALPHA", ids: [1831] } },
    { contractName: "nft", contractAction: "delegate", contractPayload: { to: "renter", symbol: "ZINGALPHA", ids: ["1831"] } },
    { contractName: "nftmarket", contractAction: "sell", contractPayload: { symbol: "ZINGALPHA", nfts: ["1831"], price: "1" } },
    { contractName: "market", contractAction: "sell", contractPayload: { symbol: "ZINGALPHA", quantity: "1", price: "1.00000000" } },
  ];
  for (const decoded of mutations) {
    assert.throws(() => assertNoProtectedAssetMutation({ account: "michael561", decoded }), /permanently excluded/);
  }
  assert.doesNotThrow(() => assertNoProtectedAssetMutation({
    account: "michael561",
    decoded: { contractName: "nft", contractAction: "transfer", contractPayload: { nfts: [{ symbol: "ZINGALPHA", ids: ["1832"] }] } },
  }));
  assert.doesNotThrow(() => assertNoProtectedAssetMutation({
    account: "michael561",
    decoded: { contractName: "market", contractAction: "sell", contractPayload: { symbol: "ZING", quantity: "1.000" } },
  }));
});

test("generic liquidation and HoloZing API routes cannot bypass the invariant", () => {
  assert.throws(() => assertLiquidationSymbolAllowed("michael561", "ZINGALPHA"), /not liquidatable/);
  assert.throws(() => parseLiquidationOptions(["--account", "michael561", "--symbol", "ZINGALPHA"]), /not liquidatable/);
  assert.throws(() => assertHoloZingApiMutationAllowed("/packopen/open", { id: 1831 }), /may not open or consume/);
  assert.throws(() => assertHoloZingApiMutationAllowed("/some/future/transfer", { ids: [1831] }), /may not open or consume/);
  assert.doesNotThrow(() => assertHoloZingApiMutationAllowed("/rewards/pending/", {}));
});

test("the signing bridge refuses the protected vial before reading a key", async () => {
  const script = fileURLToPath(new URL("../scripts/hive-broadcast.mjs", import.meta.url));
  const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => resolve({ code, stderr }));
    child.stdin.end(JSON.stringify({
      account: "michael561",
      role: "active",
      lane: "gaming",
      target: "forbidden-alpha-vial-sale",
      keyFile: "/missing/active.wif",
      operation: ["custom_json", {
        id: "ssc-mainnet-hive",
        required_auths: ["michael561"],
        required_posting_auths: [],
        json: JSON.stringify({
          contractName: "nftmarket",
          contractAction: "sell",
          contractPayload: { symbol: "ZINGALPHA", nfts: ["1831"], price: "100.00000000" },
        }),
      }],
    }));
  });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /ZINGALPHA #1831 is permanently excluded/);
  assert.doesNotMatch(result.stderr, /cannot read key file/);
});

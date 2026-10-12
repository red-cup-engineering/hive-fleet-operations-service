// transaction — build the signing digest, sign, and id a Hive transaction. Ties the pure
// serializer (lib/serialize.mjs) to the keys (lib/keys.mjs) via the chain_id-prefixed sha256
// digest. See docs/dev/notes/01-crypto-signing-spec.md §4 and 02-serialization-spec.md §5.
import { sha256 } from "./hash.mjs";
import { serializeTransaction } from "./serialize.mjs";

// Hive mainnet chain id (HF24 "Eclipse"). 32 bytes when hex-decoded.
export const CHAIN_ID =
  "beeab0de00000000000000000000000000000000000000000000000000000000";

// digest = sha256( chain_id(32 bytes) || serialized_transaction ). The chain_id is prepended
// ONLY for the signing digest; it is never part of the broadcast JSON.
export function transactionDigest(tx, chainId = CHAIN_ID) {
  const chainBuf = Buffer.from(chainId, "hex");
  const txBuf = serializeTransaction(tx);
  return sha256(Buffer.concat([chainBuf, txBuf]));
}

// signTransaction(tx, keys, chainId) -> tx with `signatures` appended (lowercase hex, 130 chars
// each). `keys` is a PrivateKey or an array of them; each signs the same digest.
export function signTransaction(tx, keys, chainId = CHAIN_ID) {
  const digest = transactionDigest(tx, chainId);
  const list = Array.isArray(keys) ? keys : [keys];
  const signatures = (tx.signatures || []).slice();
  for (const key of list) signatures.push(key.sign(digest).toString("hex"));
  return { ...tx, signatures };
}

// transactionId = first 20 bytes (40 hex chars) of sha256(serialized_transaction), WITHOUT
// the chain_id prefix.
export function transactionId(tx) {
  return sha256(serializeTransaction(tx)).toString("hex").slice(0, 40);
}

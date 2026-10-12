// secp256k1 — hand-rolled BigInt curve math for Hive/graphene signing, per 01-crypto-signing-spec
// §0, §2, §5. node:crypto is touched only through hash.mjs (sha256 + hmacSha256). Everything here —
// field/point arithmetic, scalar multiply, RFC6979 nonce, low-S, the graphene canonical loop,
// recovery id — is BigInt by hand.
import { hmacSha256, sha256 } from "./hash.mjs";

// §0.1 curve parameters.
export const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
export const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const A = 0n;
const B = 7n;
const Gx = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const Gy = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
const G = { x: Gx, y: Gy };

// ---- field helpers (mod P) ----
function mod(x, m = P) {
  const r = x % m;
  return r >= 0n ? r : r + m;
}
function inv(x, m = P) {
  // extended Euclid; m is prime here so this also yields modular inverse.
  let [old_r, r] = [mod(x, m), m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  if (old_r !== 1n) throw new Error("not invertible");
  return mod(old_s, m);
}

// ---- affine point ops, identity = null ----
function pointDouble(p1) {
  if (p1 === null) return null;
  if (p1.y === 0n) return null;
  const lam = mod((3n * p1.x * p1.x + A) * inv(2n * p1.y));
  const x3 = mod(lam * lam - 2n * p1.x);
  const y3 = mod(lam * (p1.x - x3) - p1.y);
  return { x: x3, y: y3 };
}
function pointAdd(p1, p2) {
  if (p1 === null) return p2;
  if (p2 === null) return p1;
  if (p1.x === p2.x) {
    if (mod(p1.y + p2.y) === 0n) return null; // p + (-p) = infinity
    return pointDouble(p1);
  }
  const lam = mod((p2.y - p1.y) * inv(p2.x - p1.x));
  const x3 = mod(lam * lam - p1.x - p2.x);
  const y3 = mod(lam * (p1.x - x3) - p1.y);
  return { x: x3, y: y3 };
}
function scalarMul(k, point) {
  k = mod(k, N);
  let result = null;
  let addend = point;
  while (k > 0n) {
    if (k & 1n) result = pointAdd(result, addend);
    addend = pointDouble(addend);
    k >>= 1n;
  }
  return result;
}

// §2.1 pointFromX (decompress) — y = (x^3 + 7)^((p+1)/4) mod p, pick parity.
function modPow(base, exp, m) {
  base = mod(base, m);
  let r = 1n;
  while (exp > 0n) {
    if (exp & 1n) r = mod(r * base, m);
    base = mod(base * base, m);
    exp >>= 1n;
  }
  return r;
}
function pointFromX(isYOdd, x) {
  const alpha = mod(x * x * x + B);
  let y = modPow(alpha, (P + 1n) / 4n, P);
  if ((y & 1n) !== (isYOdd ? 1n : 0n)) y = mod(P - y);
  return { x, y };
}

// ---- byte <-> bigint ----
function bytesToBig(buf) {
  let n = 0n;
  for (const b of buf) n = (n << 8n) | BigInt(b);
  return n;
}
function bigTo32(n) {
  const out = Buffer.alloc(32);
  let v = mod(n, 1n << 256n);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

// §2 public key derivation -> 33-byte compressed.
function compress(point) {
  const out = Buffer.alloc(33);
  out[0] = (point.y & 1n) === 0n ? 0x02 : 0x03;
  bigTo32(point.x).copy(out, 1);
  return out;
}
export function getPublicKey(secret32) {
  const d = bytesToBig(secret32);
  if (d <= 0n || d >= N) throw new Error("invalid private key scalar");
  return compress(scalarMul(d, G));
}
function decompress(pub33) {
  if (pub33.length !== 33 || (pub33[0] !== 0x02 && pub33[0] !== 0x03)) {
    throw new Error("invalid compressed public key");
  }
  const x = bytesToBig(pub33.subarray(1));
  return pointFromX(pub33[0] === 0x03, x);
}

// §5.0 RFC 6979 deterministic k (HMAC-SHA256), Strategy B nonce-as-zero-bytes.
function rfc6979K(hash32, d, nonce, checkSig) {
  let h = hash32;
  if (nonce > 0) {
    h = sha256(Buffer.concat([hash32, Buffer.alloc(nonce, 0)]));
  }
  const x = bigTo32(d);
  let v = Buffer.alloc(32, 0x01);
  let k = Buffer.alloc(32, 0x00);

  k = hmacSha256(k, Buffer.concat([v, Buffer.from([0x00]), x, h]));
  v = hmacSha256(k, v);
  k = hmacSha256(k, Buffer.concat([v, Buffer.from([0x01]), x, h]));
  v = hmacSha256(k, v);
  v = hmacSha256(k, v);

  let T = bytesToBig(v);
  while (T <= 0n || T >= N || !checkSig(T)) {
    k = hmacSha256(k, Buffer.concat([v, Buffer.from([0x00])]));
    v = hmacSha256(k, v);
    v = hmacSha256(k, v);
    T = bytesToBig(v);
  }
  return T;
}

// §5.1 raw ECDSA sign given k -> {r, s, kPoint} with low-S applied; null if k unusable.
function rawSign(e, d, k) {
  const Q = scalarMul(k, G);
  if (Q === null) return null;
  const r = mod(Q.x, N);
  if (r === 0n) return null;
  let s = mod(inv(k, N) * (e + d * r), N);
  if (s === 0n) return null;
  let sLow = s;
  if (s > N / 2n) sLow = N - s; // §5.1 low-S (BIP62)
  return { r, s: sLow, kPoint: Q, sFlipped: sLow !== s };
}

// §5.3 graphene canonical test on the 64-byte R||S body.
function isCanonical(rs64) {
  return (
    !(rs64[0] & 0x80) &&
    !(rs64[0] === 0 && !(rs64[1] & 0x80)) &&
    !(rs64[32] & 0x80) &&
    !(rs64[32] === 0 && !(rs64[33] & 0x80))
  );
}

// §5.7 recover the public point from (e, r, s, i).
function recoverPoint(e, r, s, i) {
  const isYOdd = (i & 1) === 1;
  const isSecondKey = (i >> 1) === 1;
  const x = isSecondKey ? r + N : r;
  if (x >= P) return null;
  const R = pointFromX(isYOdd, x);
  // sanity: R must be on curve order — n*R == infinity is guaranteed by construction here.
  const eNeg = mod(-e, N);
  const rInv = inv(r, N);
  const sR = scalarMul(s, R);
  const eNegG = scalarMul(eNeg, G);
  return scalarMul(rInv, pointAdd(sR, eNegG));
}

// §5.7 find recovery id by comparing recovered point against the signer's own point.
function recoveryId(e, r, s, Qpub) {
  for (let i = 0; i < 4; i++) {
    const Qp = recoverPoint(e, r, s, i);
    if (Qp !== null && Qp.x === Qpub.x && Qp.y === Qpub.y) return i;
  }
  throw new Error("Unable to find valid recovery factor");
}

// §5 sign: RFC6979 k, low-S, graphene canonical retry loop, recovery id.
export function sign(digest32, secret32) {
  const e = bytesToBig(digest32);
  const d = bytesToBig(secret32);
  if (d <= 0n || d >= N) throw new Error("invalid private key scalar");
  const Qpub = scalarMul(d, G);

  let nonce = 0;
  while (true) {
    let candidate = null;
    rfc6979K(digest32, d, nonce, (T) => {
      const sig = rawSign(e, d, T);
      if (sig === null) return false; // reject this T, keep iterating inside rfc6979
      candidate = sig;
      return true;
    });
    nonce++;

    const rBuf = bigTo32(candidate.r);
    const sBuf = bigTo32(candidate.s);
    const rs64 = Buffer.concat([rBuf, sBuf]);
    if (!isCanonical(rs64)) continue; // §5.4 retry with next nonce

    // recovery is computed against the low-S r,s actually emitted.
    const recovery = recoveryId(e, candidate.r, candidate.s, Qpub);
    return { signature: rs64, recovery };
  }
}

// standard ECDSA verify, for tests.
export function verify(digest32, signature64, pub33) {
  const e = bytesToBig(digest32);
  const r = bytesToBig(signature64.subarray(0, 32));
  const s = bytesToBig(signature64.subarray(32, 64));
  if (r <= 0n || r >= N || s <= 0n || s >= N) return false;
  const Q = decompress(pub33);
  const w = inv(s, N);
  const u1 = mod(e * w, N);
  const u2 = mod(r * w, N);
  const point = pointAdd(scalarMul(u1, G), scalarMul(u2, Q));
  if (point === null) return false;
  return mod(point.x, N) === r;
}

// recover compressed pubkey from digest + 64-byte sig + recovery id, for tests.
export function recover(digest32, signature64, recovery) {
  const e = bytesToBig(digest32);
  const r = bytesToBig(signature64.subarray(0, 32));
  const s = bytesToBig(signature64.subarray(32, 64));
  const Q = recoverPoint(e, r, s, recovery);
  if (Q === null) throw new Error("could not recover point");
  return compress(Q);
}

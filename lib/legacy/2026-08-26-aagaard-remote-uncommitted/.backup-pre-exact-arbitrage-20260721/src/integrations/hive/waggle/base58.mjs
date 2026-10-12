// base58 — Bitcoin-alphabet base58, big-integer method, per 01-crypto-signing-spec §1.1/§1.2.
// Leading 0x00 bytes carry no numeric value, so they are counted and re-prepended as '1' chars
// (encode) / re-emitted as 0x00 bytes (decode) explicitly.

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE = 58n;

// char -> value index, for fast decode.
const INDEX = (() => {
  const m = new Map();
  for (let i = 0; i < ALPHABET.length; i++) m.set(ALPHABET[i], i);
  return m;
})();

export function encode(buf) {
  const bytes = Buffer.from(buf);

  let num = 0n;
  for (const b of bytes) num = num * 256n + BigInt(b);

  let out = "";
  while (num > 0n) {
    const rem = Number(num % BASE);
    out = ALPHABET[rem] + out;
    num = num / BASE;
  }

  // Re-prepend a '1' for every leading 0x00 byte.
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out = "1" + out;

  return out;
}

export function decode(str) {
  let num = 0n;
  for (const ch of str) {
    const idx = INDEX.get(ch);
    if (idx === undefined) throw new Error(`invalid base58 char: ${ch}`);
    num = num * BASE + BigInt(idx);
  }

  // bigint -> minimal-length big-endian bytes.
  const digits = [];
  while (num > 0n) {
    digits.push(Number(num & 0xffn));
    num >>= 8n;
  }
  digits.reverse();

  // Count leading '1' chars => that many leading 0x00 bytes.
  let leadingZeros = 0;
  for (let i = 0; i < str.length && str[i] === "1"; i++) leadingZeros++;

  return Buffer.concat([Buffer.alloc(leadingZeros, 0), Buffer.from(digits)]);
}

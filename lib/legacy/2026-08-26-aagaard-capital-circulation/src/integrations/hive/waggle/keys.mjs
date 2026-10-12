// keys — WIF private keys and STM-prefixed public keys, per 01-crypto-signing-spec §1, §2, §3, §5.
// PrivateKey wraps a 32-byte secret (decoded/encoded as WIF, double-SHA256 checksum). PublicKey
// wraps the 33-byte compressed point (encoded as PREFIX + base58, RIPEMD-160 checksum).
import { encode, decode } from "./base58.mjs";
import { sha256d, ripemd160 } from "./hash.mjs";
import { N, getPublicKey, sign } from "./secp256k1.mjs";

const WIF_VERSION_BYTE = 0x80;

function bytesToBig(buf) {
  let n = 0n;
  for (const b of buf) n = (n << 8n) | BigInt(b);
  return n;
}

export class PrivateKey {
  constructor(secret) {
    if (!Buffer.isBuffer(secret) || secret.length !== 32) {
      throw new Error("secret must be a 32-byte Buffer");
    }
    const d = bytesToBig(secret);
    if (d <= 0n || d >= N) throw new Error("private key out of range (1 <= d < n)");
    this.secret = secret;
  }

  // §1 WIF decode: base58 -> [version][secret(32)][checksum(4)], version 0x80, double-SHA256 check.
  static from(wif) {
    const buffer = decode(wif);
    if (buffer.length !== 37) throw new Error("invalid WIF length");
    if (buffer[0] !== WIF_VERSION_BYTE) throw new Error("private key network id mismatch");
    const checksum = buffer.subarray(buffer.length - 4);
    const body = buffer.subarray(0, buffer.length - 4); // version + secret, 33 bytes
    const checksumVerify = sha256d(body).subarray(0, 4);
    if (!checksum.equals(checksumVerify)) throw new Error("checksum mismatch");
    const secret = Buffer.from(body.subarray(1)); // strip version byte
    return new PrivateKey(secret);
  }

  // §2 derive compressed public point -> PublicKey.
  createPublic(prefix = "STM") {
    const pub = PublicKey.fromBuffer(getPublicKey(this.secret));
    pub._prefix = prefix;
    return pub;
  }

  // §5.2 65-byte compact signature: headerByte = recovery + 31, then R32, then S32.
  sign(digest32) {
    const { signature, recovery } = sign(digest32, this.secret);
    return Buffer.concat([Buffer.from([recovery + 31]), signature]);
  }

  // §1 re-encode to WIF: [0x80][secret] + first 4 bytes of double-SHA256.
  toString() {
    const body = Buffer.concat([Buffer.from([WIF_VERSION_BYTE]), this.secret]);
    const checksum = sha256d(body).subarray(0, 4);
    return encode(Buffer.concat([body, checksum]));
  }
}

export class PublicKey {
  constructor(key) {
    if (!Buffer.isBuffer(key) || key.length !== 33) {
      throw new Error("public key must be a 33-byte compressed Buffer");
    }
    if (key[0] !== 0x02 && key[0] !== 0x03) throw new Error("invalid compression prefix");
    this.key = key;
    this._prefix = "STM";
  }

  static fromBuffer(buf33) {
    return new PublicKey(Buffer.from(buf33));
  }

  // §3 decode PREFIX + base58(body), verify RIPEMD-160(key)[0:4] checksum.
  static from(str, prefix = "STM") {
    if (!str.startsWith(prefix)) throw new Error(`public key prefix mismatch (expected ${prefix})`);
    const body = decode(str.slice(prefix.length));
    const key = body.subarray(0, body.length - 4);
    const checksum = body.subarray(body.length - 4);
    const checksumVerify = ripemd160(key).subarray(0, 4);
    if (!checksum.equals(checksumVerify)) throw new Error("public key checksum mismatch");
    const pub = new PublicKey(Buffer.from(key));
    pub._prefix = prefix;
    return pub;
  }

  toBuffer() {
    return this.key;
  }

  // §3 encode: PREFIX + base58( compressed(33) ++ ripemd160(compressed)[0:4] ).
  toString(prefix = this._prefix) {
    const checksum = ripemd160(this.key).subarray(0, 4);
    return prefix + encode(Buffer.concat([this.key, checksum]));
  }
}

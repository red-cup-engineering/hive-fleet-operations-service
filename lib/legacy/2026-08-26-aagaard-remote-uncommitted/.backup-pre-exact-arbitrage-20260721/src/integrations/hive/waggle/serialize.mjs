// serialize.mjs — pure GRAPHENE/Hive binary serialization, Node builtins only, self-contained.
// Implements docs/dev/notes/02-serialization-spec.md byte-for-byte. Imports nothing from other
// package files so it can compose independently. Public-key fields arrive pre-converted as
// 33-byte Buffers (or null → 33 zero bytes); no "STM..." decoding happens here.

// --- ByteWriter: a growable little-endian byte sink (spec §0: all fixed-width ints are LE) ---

export class ByteWriter {
  constructor() {
    this._chunks = [];
  }
  _push(buf) { this._chunks.push(buf); return this; }

  uint8(v) { const b = Buffer.allocUnsafe(1); b.writeUInt8(v & 0xff, 0); return this._push(b); }
  int8(v) { const b = Buffer.allocUnsafe(1); b.writeInt8(v, 0); return this._push(b); }

  uint16(v) { const b = Buffer.allocUnsafe(2); b.writeUInt16LE(v & 0xffff, 0); return this._push(b); }
  int16(v) { const b = Buffer.allocUnsafe(2); b.writeInt16LE(v, 0); return this._push(b); }

  uint32(v) { const b = Buffer.allocUnsafe(4); b.writeUInt32LE(v >>> 0, 0); return this._push(b); }
  int32(v) { const b = Buffer.allocUnsafe(4); b.writeInt32LE(v | 0, 0); return this._push(b); }

  // int64 LE, two's-complement, from a BigInt. Used for asset amounts.
  int64(v) {
    const b = Buffer.allocUnsafe(8);
    b.writeBigInt64LE(BigInt(v), 0);
    return this._push(b);
  }

  // varint = unsigned LEB128, 32-bit unsigned domain (spec §1). counts / lengths / op-ids.
  varint(value) {
    let v = value >>> 0;
    do {
      let byte = v & 0x7f;
      v >>>= 7;
      if (v !== 0) byte |= 0x80;
      this.uint8(byte);
    } while (v !== 0);
    return this;
  }

  boolean(v) { return this.uint8(v ? 0x01 : 0x00); }

  // string = varint(utf8 byte length) + raw utf8 bytes. Empty → 0x00.
  string(s) {
    const buf = Buffer.from(s == null ? "" : String(s), "utf8");
    this.varint(buf.length);
    return this._push(buf);
  }

  // raw bytes verbatim (fixed-width, e.g. pubkey 33 bytes, symbol field)
  bytes(buf) { return this._push(Buffer.from(buf)); }

  toBuffer() { return Buffer.concat(this._chunks); }
}

// --- Asset (spec §2): int64 amount LE | uint8 precision | char[7] symbol ASCII NUL-padded ---

// HIVE→STEEM, HBD→SBD on the wire (testnet TESTS/TBD stay). Precision for known symbols.
const SYMBOL_MAP = { HIVE: "STEEM", HBD: "SBD" };
const SYMBOL_PRECISION = { HIVE: 3, HBD: 3, STEEM: 3, SBD: 3, VESTS: 6, TESTS: 3, TBD: 3 };

function wireSymbol(sym) {
  return Object.prototype.hasOwnProperty.call(SYMBOL_MAP, sym) ? SYMBOL_MAP[sym] : sym;
}

export function serializeAsset(asset) {
  let amountStr, precision, symbol;

  if (typeof asset === "string") {
    // e.g. "1.000 HIVE"
    const parts = asset.trim().split(/\s+/);
    if (parts.length !== 2) throw new Error(`invalid asset string: ${JSON.stringify(asset)}`);
    amountStr = parts[0];
    symbol = parts[1];
    const dot = amountStr.indexOf(".");
    // precision from the decimal places given, else from the known symbol.
    if (dot >= 0) {
      precision = amountStr.length - dot - 1;
    } else if (Object.prototype.hasOwnProperty.call(SYMBOL_PRECISION, symbol)) {
      precision = SYMBOL_PRECISION[symbol];
    } else {
      precision = 0;
    }
  } else if (asset && typeof asset === "object") {
    symbol = asset.symbol;
    if (asset.precision != null) {
      precision = asset.precision; // honored if given explicitly
    } else if (Object.prototype.hasOwnProperty.call(SYMBOL_PRECISION, symbol)) {
      precision = SYMBOL_PRECISION[symbol];
    } else {
      precision = 0;
    }
    amountStr = String(asset.amount);
  } else {
    throw new Error(`invalid asset: ${JSON.stringify(asset)}`);
  }

  // amount = round(value * 10^precision) as integer. Parse with BigInt-safe scaling to avoid
  // float error: split the decimal text and pad/truncate to `precision` digits.
  const intAmount = scaleDecimal(amountStr, precision);

  const w = new ByteWriter();
  w.int64(intAmount);
  w.uint8(precision);
  // symbol field: ASCII, NUL-padded to exactly 7 bytes.
  const symBuf = Buffer.alloc(7, 0);
  Buffer.from(wireSymbol(symbol), "ascii").copy(symBuf, 0, 0, 7);
  w.bytes(symBuf);
  return w.toBuffer();
}

// Convert a decimal string to an integer (BigInt) scaled by 10^precision, with rounding.
function scaleDecimal(amountStr, precision) {
  let s = amountStr.trim();
  let neg = false;
  if (s.startsWith("-")) { neg = true; s = s.slice(1); }
  else if (s.startsWith("+")) { s = s.slice(1); }

  let [intPart = "0", fracPart = ""] = s.split(".");
  if (intPart === "") intPart = "0";

  let scaled;
  if (fracPart.length <= precision) {
    const padded = fracPart.padEnd(precision, "0");
    scaled = BigInt(intPart + padded); // padded is "" when precision === 0
  } else {
    // fractional part longer than precision: keep `precision` digits, round on the next.
    const keep = fracPart.slice(0, precision);
    const roundDigit = fracPart.charCodeAt(precision) - 48;
    let base = BigInt(intPart + keep);
    if (roundDigit >= 5) base += 1n;
    scaled = base;
  }
  return neg ? -scaled : scaled;
}

// --- Authority struct (spec §4) ---
// uint32 weight_threshold | array<[string account, uint16 weight]> account_auths
//                         | array<[pubkey(33) key, uint16 weight]> key_auths

function serializeAuthority(w, auth) {
  w.uint32(auth.weight_threshold >>> 0);

  const accountAuths = auth.account_auths || [];
  w.varint(accountAuths.length);
  for (const [account, weight] of accountAuths) {
    w.string(account);
    w.uint16(weight);
  }

  const keyAuths = auth.key_auths || [];
  w.varint(keyAuths.length);
  for (const [key, weight] of keyAuths) {
    writePubkey(w, key);
    w.uint16(weight);
  }
}

// pubkey: 33-byte Buffer, or null/undefined → 33 zero bytes (spec §3).
function writePubkey(w, key) {
  if (key == null) {
    w.bytes(Buffer.alloc(33, 0));
  } else {
    const buf = Buffer.from(key);
    if (buf.length !== 33) throw new Error(`pubkey must be 33 bytes, got ${buf.length}`);
    w.bytes(buf);
  }
}

// optional<T>: 1 flag byte (0x00 absent / 0x01 present + T). Tests `value !== undefined`.
function serializeOptional(w, value, writeT) {
  if (value === undefined || value === null) {
    w.uint8(0x00);
  } else {
    w.uint8(0x01);
    writeT(w, value);
  }
}

// --- Operation ID table (spec §6) ---

export const OPERATION_IDS = {
  vote: 0,
  comment: 1,
  transfer: 2,
  transfer_to_vesting: 3,
  withdraw_vesting: 4,
  limit_order_create: 5,
  limit_order_cancel: 6,
  feed_publish: 7,
  convert: 8,
  account_create: 9,
  account_update: 10,
  witness_update: 11,
  account_witness_vote: 12,
  account_witness_proxy: 13,
  pow: 14,
  custom: 15,
  report_over_production: 16,
  delete_comment: 17,
  custom_json: 18,
  comment_options: 19,
  set_withdraw_vesting_route: 20,
  limit_order_create2: 21,
  claim_account: 22,
  create_claimed_account: 23,
  request_account_recovery: 24,
  recover_account: 25,
  change_recovery_account: 26,
  escrow_transfer: 27,
  escrow_dispute: 28,
  escrow_release: 29,
  pow2: 30,
  escrow_approve: 31,
  transfer_to_savings: 32,
  transfer_from_savings: 33,
  cancel_transfer_from_savings: 34,
  custom_binary: 35,
  decline_voting_rights: 36,
  reset_account: 37,
  set_reset_account: 38,
  claim_reward_balance: 39,
  delegate_vesting_shares: 40,
  account_create_with_delegation: 41,
  witness_set_properties: 42,
  account_update2: 43,
  create_proposal: 44,
  update_proposal_votes: 45,
  remove_proposal: 46,
  update_proposal: 47,
  collateralized_convert: 48,
  recurrent_transfer: 49,
};

// --- Per-operation body serializers (spec §7) ---

const OP_BODY = {
  // vote (0): string voter; string author; string permlink; int16 weight
  vote(w, p) {
    w.string(p.voter);
    w.string(p.author);
    w.string(p.permlink);
    w.int16(p.weight);
  },

  // comment (1)
  comment(w, p) {
    w.string(p.parent_author);
    w.string(p.parent_permlink);
    w.string(p.author);
    w.string(p.permlink);
    w.string(p.title);
    w.string(p.body);
    w.string(p.json_metadata);
  },

  // transfer (2): string from; string to; asset amount; string memo
  transfer(w, p) {
    w.string(p.from);
    w.string(p.to);
    w.bytes(serializeAsset(p.amount));
    w.string(p.memo);
  },

  // transfer_to_vesting (3): string from; string to; asset amount
  transfer_to_vesting(w, p) {
    w.string(p.from);
    w.string(p.to);
    w.bytes(serializeAsset(p.amount));
  },

  // delete_comment (17): string author; string permlink
  delete_comment(w, p) {
    w.string(p.author);
    w.string(p.permlink);
  },

  // custom_json (18): array<string> required_auths; array<string> required_posting_auths;
  //                   string id; string json
  custom_json(w, p) {
    const reqAuths = p.required_auths || [];
    w.varint(reqAuths.length);
    for (const a of reqAuths) w.string(a);

    const reqPosting = p.required_posting_auths || [];
    w.varint(reqPosting.length);
    for (const a of reqPosting) w.string(a);

    w.string(p.id);
    w.string(p.json);
  },

  // comment_options (19)
  comment_options(w, p) {
    w.string(p.author);
    w.string(p.permlink);
    w.bytes(serializeAsset(p.max_accepted_payout));
    w.uint16(p.percent_hbd);
    w.boolean(p.allow_votes);
    w.boolean(p.allow_curation_rewards);

    const extensions = p.extensions || [];
    w.varint(extensions.length);
    for (const ext of extensions) {
      serializeCommentOptionsExtension(w, ext);
    }
  },

  // claim_reward_balance (39)
  claim_reward_balance(w, p) {
    w.string(p.account);
    w.bytes(serializeAsset(p.reward_hive));
    w.bytes(serializeAsset(p.reward_hbd));
    w.bytes(serializeAsset(p.reward_vests));
  },

  // account_update2 (43)
  account_update2(w, p) {
    w.string(p.account);
    serializeOptional(w, p.owner, serializeAuthority);
    serializeOptional(w, p.active, serializeAuthority);
    serializeOptional(w, p.posting, serializeAuthority);
    serializeOptional(w, p.memo_key, writePubkey);
    w.string(p.json_metadata);
    w.string(p.posting_json_metadata);
    w.varint(0); // extensions array<void> always empty
  },
};

// comment_options extension: static-variant varint(variant_id) + body.
// Beneficiaries: variant id 0, body = array<{string account, uint16 weight}>.
// Accepts either { 0: {beneficiaries:[...]} }-style, a [variantId, body] tuple, or the JSON
// convention ["comment_payout_beneficiaries", {beneficiaries:[...]}].
function serializeCommentOptionsExtension(w, ext) {
  let variantId;
  let body;

  if (Array.isArray(ext)) {
    const [id, b] = ext;
    variantId = id === "comment_payout_beneficiaries" ? 0 : id;
    body = b;
  } else if (ext && typeof ext === "object") {
    if ("beneficiaries" in ext) { variantId = 0; body = ext; }
    else throw new Error(`unsupported comment_options extension: ${JSON.stringify(ext)}`);
  } else {
    throw new Error(`unsupported comment_options extension: ${JSON.stringify(ext)}`);
  }

  w.varint(variantId);
  if (variantId === 0) {
    const beneficiaries = body.beneficiaries || [];
    w.varint(beneficiaries.length);
    for (const ben of beneficiaries) {
      w.string(ben.account);
      w.uint16(ben.weight);
    }
  } else {
    throw new Error(`unsupported comment_options extension variant id ${variantId}`);
  }
}

// --- Public API ---

// serializeOperation(op) where op = [name, payload]. Writes varint(op_id) then op body.
export function serializeOperation(op) {
  const [name, payload] = op;
  if (!Object.prototype.hasOwnProperty.call(OPERATION_IDS, name)) {
    throw new Error(`unknown operation: ${name}`);
  }
  const body = OP_BODY[name];
  if (!body) throw new Error(`operation not implemented: ${name}`);

  const w = new ByteWriter();
  w.varint(OPERATION_IDS[name]);
  body(w, payload || {});
  return w.toBuffer();
}

// serializeTransaction(tx) — spec §5.
export function serializeTransaction(tx) {
  const w = new ByteWriter();

  w.uint16(tx.ref_block_num & 0xffff);
  w.uint32(tx.ref_block_prefix >>> 0);

  // expiration: number (epoch seconds) or ISO string without timezone → append 'Z', UTC.
  let exp;
  if (typeof tx.expiration === "number") {
    exp = tx.expiration;
  } else if (typeof tx.expiration === "string") {
    exp = Math.floor(new Date(tx.expiration + "Z").getTime() / 1000);
  } else {
    throw new Error(`invalid expiration: ${JSON.stringify(tx.expiration)}`);
  }
  w.uint32(exp >>> 0);

  const operations = tx.operations || [];
  w.varint(operations.length);
  for (const op of operations) {
    w.bytes(serializeOperation(op));
  }

  // extensions: array<string>, assumed empty → varint(0).
  w.varint(0);

  return w.toBuffer();
}

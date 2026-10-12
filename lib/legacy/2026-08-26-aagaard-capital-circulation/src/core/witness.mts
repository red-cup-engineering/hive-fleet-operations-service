// core/witness — Aagaard's own notation and witness-log primitives.
//
// Aagaard currently owns this local notation and witness-log implementation.
// It does not claim conformance to the Union RMN/RWIL profiles; replacing this
// private representation with direct RMN and RWIL provider contracts remains
// a separate cut from removing the former umbrella dependency.

import { createHash } from "node:crypto";

/** A minimal tagged-term notation: a leaf mark, or a pair of terms. Enough to
 *  give each capability/verb combination a stable symbolic action value. */
export type Tm = { readonly mark: string } | { readonly pair: readonly [Tm, Tm] };

export const tm = {
  mark(value: string): Tm {
    return Object.freeze({ mark: value });
  },
  pair(a: Tm, b: Tm): Tm {
    return Object.freeze({ pair: Object.freeze([a, b]) as readonly [Tm, Tm] });
  },
};

export type WitnessValue =
  | string
  | number
  | boolean
  | null
  | readonly WitnessValue[]
  | { readonly [key: string]: WitnessValue };

export interface WitnessRow {
  readonly entity: string;
  readonly value: WitnessValue;
  readonly context: WitnessValue;
  readonly at: string;
  /** A stable digest of (entity, value, context, at) under canonical JSON —
   *  two witness rows digest identically iff they carry the same fact. */
  readonly digest: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** A value serialized with sorted object keys at every level, so the same
 *  fact always produces the same string regardless of construction order. */
export function canonicalWitnessValue(value: WitnessValue): string {
  return JSON.stringify(canonicalize(value));
}

export function witnessCell(entity: string, value: WitnessValue, context: WitnessValue, at: string): WitnessRow {
  const digest = createHash("sha256").update(canonicalWitnessValue({ entity, value, context, at })).digest("hex").slice(0, 16);
  return Object.freeze({ entity, value, context, at, digest });
}

export interface WitnessLogInformation {
  readonly rows: number;
  readonly uniqueWitnesses: number;
  readonly duplicateWitnesses: number;
}

/** Summary stats over a batch of witness rows: how many are genuinely
 *  distinct facts (by digest) versus repeats of one already seen. */
export function witnessLogInformation(rows: readonly WitnessRow[]): WitnessLogInformation {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const row of rows) {
    if (seen.has(row.digest)) duplicates += 1;
    else seen.add(row.digest);
  }
  return Object.freeze({ rows: rows.length, uniqueWitnesses: seen.size, duplicateWitnesses: duplicates });
}

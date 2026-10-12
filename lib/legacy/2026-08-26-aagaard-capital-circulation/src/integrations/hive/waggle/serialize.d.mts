export class ByteWriter {
  uint8(value: number): this; int8(value: number): this; uint16(value: number): this; int16(value: number): this;
  uint32(value: number): this; int32(value: number): this; int64(value: bigint): this; varint(value: number): this;
  boolean(value: boolean): this; string(value: unknown): this; bytes(value: Uint8Array): this; toBuffer(): Buffer;
}
export const OPERATION_IDS: Readonly<Record<string, number>>;
export function serializeAsset(asset: unknown): Buffer;
export function serializeOperation(operation: readonly [string, any]): Buffer;
export function serializeTransaction(transaction: Readonly<Record<string, any>>): Buffer;

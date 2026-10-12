/**
 * Asserts that a value is a non-null, non-array object and narrows it to a
 * readonly record, or throws a labeled TypeError.
 *
 * @param value - candidate value.
 * @param label - noun used in the thrown message, e.g. "merchant transfer knowledge".
 * @returns the same value, narrowed to a readonly record.
 * @throws {TypeError} when value is not a plain object.
 */
export function assertPlainObject(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Readonly<Record<string, unknown>>;
}

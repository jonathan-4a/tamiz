export function actualType(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "invalid Date" : "Date";
  if (typeof value === "number" && !Number.isFinite(value)) return "non-finite number";
  return typeof value;
}

export function formatValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return `'${value}'`;
  return String(value);
}

export function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function listValues(values: readonly unknown[]): string {
  return values.map(formatValue).join(", ");
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function assertPlainRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(`[tamiz] ${label} must be a plain object; received ${actualType(value)}.`);
  }
}

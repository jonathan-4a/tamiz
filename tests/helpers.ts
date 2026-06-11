import { expect } from "vitest";
import { FilterEngine, FilterRegistry, loadSchemaFromObject } from "../src/index.js";
import type { FilterResult } from "../src/index.js";

export { FilterEngine, FilterRegistry, loadSchemaFromObject };

// Fixed reference point — all date tests use this so results are deterministic.
export const NOW = new Date("2024-06-15T12:00:00Z");

export function daysFromNow(n: number): Date {
  return new Date(NOW.getTime() + n * 86_400_000);
}

export function makeEngine(
  fields: Record<string, object>,
  extras: Record<string, unknown> = {},
) {
  return new FilterEngine({ schema: loadSchema({ fields, ...extras }) });
}

export function loadSchema(tamiz: Record<string, unknown>) {
  return loadSchemaFromObject({ tamiz } as Parameters<typeof loadSchemaFromObject>[0]);
}

export async function expectPass(result: FilterResult | Promise<FilterResult>) {
  const actual = await result;
  expect(actual.ok).toBe(true);
}

export async function expectFail(
  result: FilterResult | Promise<FilterResult>,
  field: string,
  rule: string,
) {
  const actual = await result;
  expect(actual.ok).toBe(false);
  if (!actual.ok) {
    expect(actual.error.field).toBe(field);
    expect(actual.error.rule).toBe(rule);
  }
}

export async function expectMissingField(action: () => unknown, field: string) {
  await expect(Promise.resolve().then(action)).rejects.toThrow(new RegExp(`missing required field '${field}'`));
}

export async function expectExempted(result: FilterResult | Promise<FilterResult>) {
  const actual = await result;
  expect(actual.ok).toBe(true);
  if (actual.ok) expect(actual.reason).toBe("exempted");
}

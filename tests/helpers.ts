import { expect } from "vitest";
import { FilterEngine, FilterRegistry, loadSchemaFromObject } from "../src/index.js";

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

export function expectPass(result: { ok: boolean }) {
  expect(result.ok).toBe(true);
}

export function expectFail(
  result: { ok: boolean; error?: { field?: string; rule?: string } },
  field: string,
  rule: string,
) {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error?.field).toBe(field);
    expect(result.error?.rule).toBe(rule);
  }
}

export function expectMissingField(action: () => unknown, field: string) {
  expect(action).toThrow(new RegExp(`missing required field '${field}'`));
}

export function expectExempted(result: { ok: boolean; reason?: string }) {
  expect(result.ok).toBe(true);
  if (result.ok) expect((result as any).reason).toBe("exempted");
}

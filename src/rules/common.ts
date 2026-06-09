import type { RuleFailure } from "../types.js";
import { actualType, formatValue, listValues } from "../util.js";

export function typeFailure(field: string, expected: string, value: unknown): never {
  throw new Error(
    `[tamiz] Field '${field}' type mismatch: expected ${article(expected)} ${expected}; received ${actualType(value)}.`,
  );
}

export function nullableFailure(field: string): RuleFailure {
  return {
    field,
    rule: "nullable",
    message: `Field '${field}' must not be empty.`,
  };
}

export function allowedValuesFailure(field: string, value: unknown, values: readonly unknown[]): RuleFailure {
  return {
    field,
    rule: "allowedValues",
    message: `Field '${field}' must be one of [${listValues(values)}]; received ${formatValue(value)}.`,
  };
}

export function blockedValuesFailure(field: string, value: unknown): RuleFailure {
  return {
    field,
    rule: "blockedValues",
    message: `Field '${field}' has blocked value ${formatValue(value)}.`,
  };
}

function article(word: string): "a" | "an" {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

import type { RuleFailure } from "../types.js";
import type { StringRules } from "../types.js";
import {
  allowedValuesFailure,
  blockedValuesFailure,
  nullableFailure,
  typeFailure,
} from "./common.js";

export function evaluateString(field: string, value: unknown, rules: StringRules): RuleFailure | null {
  if (value === null || value === undefined || value === "") {
    return rules.nullable === false ? nullableFailure(field) : null;
  }

  if (typeof value !== "string") {
    typeFailure(field, "string", value);
  }

  if (rules.minLength !== undefined && value.length < rules.minLength) {
    return {
      field,
      rule: "minLength",
      message: `Field '${field}' must be at least ${rules.minLength} characters long; received ${value.length}.`,
    };
  }

  if (rules.maxLength !== undefined && value.length > rules.maxLength) {
    return {
      field,
      rule: "maxLength",
      message: `Field '${field}' must be at most ${rules.maxLength} characters long; received ${value.length}.`,
    };
  }

  if (rules.allowedValues !== undefined && !matchesStringList(value, rules.allowedValues, rules)) {
    return allowedValuesFailure(field, value, rules.allowedValues);
  }

  if (rules.blockedValues !== undefined && matchesStringList(value, rules.blockedValues, rules)) {
    return blockedValuesFailure(field, value);
  }

  return null;
}

function matchesStringList(
  value: string,
  values: readonly string[],
  rules: StringRules,
): boolean {
  if (rules.caseSensitive !== false) return values.includes(value);

  const normalizedValue = value.toLowerCase();
  return values.some((entry) => entry.toLowerCase() === normalizedValue);
}

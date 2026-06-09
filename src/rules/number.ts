import type { RuleFailure } from "../types.js";
import type { NumberRules } from "../types.js";
import { formatValue } from "../util.js";
import {
  allowedValuesFailure,
  blockedValuesFailure,
  nullableFailure,
  typeFailure,
} from "./common.js";

export function evaluateNumber(field: string, value: unknown, rules: NumberRules): RuleFailure | null {
  if (value === null || value === undefined) {
    return rules.nullable === false ? nullableFailure(field) : null;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    typeFailure(field, "number", value);
  }

  if (rules.min !== undefined && value < rules.min) {
    return {
      field,
      rule: "min",
      message: `Field '${field}' must be >= ${rules.min}; received ${formatValue(value)}.`,
    };
  }

  if (rules.max !== undefined && value > rules.max) {
    return {
      field,
      rule: "max",
      message: `Field '${field}' must be <= ${rules.max}; received ${formatValue(value)}.`,
    };
  }

  if (rules.allowedValues !== undefined && !rules.allowedValues.includes(value)) {
    return allowedValuesFailure(field, value, rules.allowedValues);
  }

  if (rules.blockedValues !== undefined && rules.blockedValues.includes(value)) {
    return blockedValuesFailure(field, value);
  }

  return null;
}

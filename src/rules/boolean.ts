import type { RuleFailure } from "../types.js";
import type { BooleanRules } from "../types.js";
import { formatValue } from "../util.js";
import {
  nullableFailure,
  typeFailure,
} from "./common.js";

export function evaluateBoolean(field: string, value: unknown, rules: BooleanRules): RuleFailure | null {
  if (value === null || value === undefined) {
    return rules.nullable === false ? nullableFailure(field) : null;
  }

  if (typeof value !== "boolean") {
    typeFailure(field, "boolean", value);
  }

  if (rules.mustBe !== undefined && value !== rules.mustBe) {
    return {
      field,
      rule: "mustBe",
      message: `Field '${field}' must be ${formatValue(rules.mustBe)}; received ${formatValue(value)}.`,
    };
  }

  return null;
}

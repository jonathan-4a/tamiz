import type { RuleFailure } from "../types.js";
import type { DateRules } from "../types.js";
import { nullableFailure, typeFailure } from "./common.js";

const DAY_MS = 86_400_000;

export function evaluateDate(
  field: string,
  value: unknown,
  rules: DateRules,
  now: Date = new Date(),
): RuleFailure | null {
  if (value === null || value === undefined) {
    return rules.nullable === false ? nullableFailure(field) : null;
  }

  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    typeFailure(field, "date", value);
  }

  if (rules.after !== undefined) {
    const boundary = new Date(rules.after);
    if (value <= boundary) {
      return {
        field,
        rule: "after",
        message: `Field '${field}' must be after ${rules.after}.`,
      };
    }
  }

  if (rules.before !== undefined) {
    const boundary = new Date(rules.before);
    if (value >= boundary) {
      return {
        field,
        rule: "before",
        message: `Field '${field}' must be before ${rules.before}.`,
      };
    }
  }

  if (rules.maxAgeDays !== undefined) {
    const cutoff = new Date(now.getTime() - rules.maxAgeDays * DAY_MS);
    if (value < cutoff) {
      return {
        field,
        rule: "maxAgeDays",
        message: `Field '${field}' must not be older than ${rules.maxAgeDays} days.`,
      };
    }
  }

  if (rules.mustBeFuture === true && value <= now) {
    return {
      field,
      rule: "mustBeFuture",
      message: `Field '${field}' must be in the future.`,
    };
  }

  if (rules.mustBePast === true && value >= now) {
    return {
      field,
      rule: "mustBePast",
      message: `Field '${field}' must be in the past.`,
    };
  }

  return null;
}

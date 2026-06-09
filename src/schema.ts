import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { z } from "zod";
import { isPlainObject } from "./util.js";
import type {
  BooleanRules,
  DateRules,
  ExemptionRule,
  FieldRules,
  FieldType,
  FilterSchema,
  NumberRules,
  StringRules,
} from "./types.js";

export type {
  BooleanRules,
  DateRules,
  ExemptionRule,
  FieldRules,
  FieldType,
  FilterSchema,
  NumberRules,
  StringRules,
};

/** Parse a schema from a plain JavaScript object. The object must contain a top-level `tamiz` key wrapping the config. */
export function loadSchemaFromObject(config: object): FilterSchema {
  return normalizeSchema(config);
}

/** Read a YAML schema file from disk and parse it into a {@link FilterSchema}. */
export function loadSchemaFromFile(path: string): FilterSchema {
  let content: string;

  try {
    content = readFileSync(path, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[tamiz] Could not read schema file '${path}': ${message}`);
  }

  return normalizeSchema(parseYaml(content));
}

function parseYaml(content: string): unknown {
  try {
    return yaml.load(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[tamiz] Invalid YAML: ${message}`);
  }
}

const nullableSchema = z
  .undefined()
  .or(z.literal(false));

const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const stringRulesSchema = z
  .object({
    type: z.literal("string"),
    nullable: nullableSchema.optional(),
    minLength: z.number().int().min(1).optional(),
    maxLength: z.number().int().min(0).optional(),
    allowedValues: z.array(z.string()).nonempty().optional(),
    blockedValues: z.array(z.string()).nonempty().optional(),
    caseSensitive: z.boolean().optional(),
  })
  .strict();

const numberRulesSchema = z
  .object({
    type: z.literal("number"),
    nullable: nullableSchema.optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    allowedValues: z.array(z.number().finite()).nonempty().optional(),
    blockedValues: z.array(z.number().finite()).nonempty().optional(),
  })
  .strict();

const booleanRulesSchema = z
  .object({
    type: z.literal("boolean"),
    nullable: nullableSchema.optional(),
    mustBe: z.boolean().optional(),
  })
  .strict();

const dateRulesSchema = z
  .object({
    type: z.literal("date"),
    nullable: nullableSchema.optional(),
    after: z.string().optional(),
    before: z.string().optional(),
    maxAgeDays: z.number().int().min(1).optional(),
    mustBeFuture: z.boolean().optional(),
    mustBePast: z.boolean().optional(),
  })
  .strict();

const fieldRulesSchema = z.discriminatedUnion("type", [
  stringRulesSchema,
  numberRulesSchema,
  booleanRulesSchema,
  dateRulesSchema,
]);

const exemptionSchema = z.object({
  field: z.string().min(1),
  values: z.array(scalarSchema).nonempty(),
});

function normalizeSchema(raw: unknown): FilterSchema {
  const schema = unwrapConfig(raw);

  if (schema.advancedFilter !== undefined && typeof schema.advancedFilter !== "boolean") {
    throw new Error("[tamiz] 'advancedFilter' must be a boolean when defined");
  }

  if (!isPlainObject(schema.fields)) {
    throw new Error("[tamiz] Schema must contain a 'fields' object");
  }

  const fields: Record<string, FieldRules> = {};

  for (const [field, rawRules] of Object.entries(schema.fields)) {
    if (field.trim() === "") {
      throw new Error("[tamiz] Field names must be non-empty strings");
    }
    fields[field] = normalizeFieldRules(field, rawRules);
  }

  const exemptions = normalizeExemptions(schema.exemptions);

  return {
    advancedFilter: schema.advancedFilter === true,
    fields,
    exemptions,
  };
}

function unwrapConfig(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) {
    throw new Error("[tamiz] Schema must be a plain object");
  }

  if (raw.tamiz === undefined) {
    throw new Error("[tamiz] Schema must contain a top-level 'tamiz' object");
  }

  if (!isPlainObject(raw.tamiz)) {
    throw new Error("[tamiz] Top-level 'tamiz' must be an object");
  }

  return raw.tamiz;
}

function normalizeFieldRules(field: string, rawRules: unknown): FieldRules {
  if (!isPlainObject(rawRules)) {
    throw new Error(`[tamiz] Field '${field}' rules must be an object`);
  }

  const type = rawRules.type;
  if (type !== "string" && type !== "number" && type !== "boolean" && type !== "date") {
    throw new Error(
      `[tamiz] Field '${field}' must declare type as one of: string, number, boolean, date`,
    );
  }

  if (rawRules.nullable === true) {
    throw new Error(
      `[tamiz] Field '${field}': 'nullable: true' is not valid — only 'nullable: false' has meaning. ` +
      `Omit the key entirely to allow empty values.`,
    );
  }

  const parseResult = fieldRulesSchema.safeParse(rawRules);
  if (!parseResult.success) {
    const firstIssue = parseResult.error.issues[0];
    throw new Error(`[tamiz] Field '${field}': ${zodIssueToMessage(field, firstIssue)}`);
  }

  switch (type) {
    case "string":
      return validateStringRules(field, parseResult.data as StringRules);
    case "number":
      return validateNumberRules(field, parseResult.data as NumberRules);
    case "boolean":
      return parseResult.data as BooleanRules;
    case "date":
      return validateDateRules(field, parseResult.data as DateRules);
  }
}

function validateStringRules(field: string, rules: StringRules): StringRules {
  const { minLength, maxLength, allowedValues, blockedValues, caseSensitive } = rules;

  if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
    throw new Error(
      `[tamiz] Field '${field}': 'minLength' (${minLength}) must not exceed 'maxLength' (${maxLength})`,
    );
  }

  if (allowedValues !== undefined && blockedValues !== undefined) {
    throwOnBothValueLists(field, allowedValues, blockedValues);
  }

  const stringNorm = caseSensitive === false ? (v: unknown) => String(v).toLowerCase() : undefined;
  assertNoDuplicates(field, "allowedValues", allowedValues, stringNorm);
  assertNoDuplicates(field, "blockedValues", blockedValues, stringNorm);

  if (allowedValues !== undefined) {
    if (minLength !== undefined) {
      const tooShort = allowedValues.filter((v) => v.length < minLength);
      if (tooShort.length > 0) {
        throw new Error(
          `[tamiz] Field '${field}': allowedValues entries shorter than minLength (${minLength}): [${tooShort.map((v) => `'${v}'`).join(", ")}]`,
        );
      }
    }
    if (maxLength !== undefined) {
      const tooLong = allowedValues.filter((v) => v.length > maxLength);
      if (tooLong.length > 0) {
        throw new Error(
          `[tamiz] Field '${field}': allowedValues entries longer than maxLength (${maxLength}): [${tooLong.map((v) => `'${v}'`).join(", ")}]`,
        );
      }
    }
  }

  return rules;
}

function validateNumberRules(field: string, rules: NumberRules): NumberRules {
  const { min, max, allowedValues, blockedValues } = rules;

  if (min !== undefined && max !== undefined && min > max) {
    throw new Error(`[tamiz] Field '${field}': 'min' (${min}) must not exceed 'max' (${max})`);
  }

  if (allowedValues !== undefined && blockedValues !== undefined) {
    throwOnBothValueLists(field, allowedValues, blockedValues);
  }

  assertNoDuplicates(field, "allowedValues", allowedValues);
  assertNoDuplicates(field, "blockedValues", blockedValues);

  if (allowedValues !== undefined) {
    const outOfRange = allowedValues.filter(
      (v) => (min !== undefined && v < min) || (max !== undefined && v > max),
    );
    if (outOfRange.length > 0) {
      throw new Error(
        `[tamiz] Field '${field}': allowedValues entries outside min/max range: [${outOfRange.join(", ")}]`,
      );
    }
  }

  return rules;
}

function validateDateRules(field: string, rules: DateRules): DateRules {
  const { after, before, mustBeFuture, mustBePast } = rules;

  if (after !== undefined && Number.isNaN(new Date(after).getTime())) {
    throw new Error(`[tamiz] Field '${field}': 'after' must be a valid date string`);
  }
  if (before !== undefined && Number.isNaN(new Date(before).getTime())) {
    throw new Error(`[tamiz] Field '${field}': 'before' must be a valid date string`);
  }

  if (after !== undefined && before !== undefined) {
    if (new Date(after) >= new Date(before)) {
      throw new Error(`[tamiz] Field '${field}': 'after' must be before 'before'`);
    }
  }

  if (mustBeFuture === true && mustBePast === true) {
    throw new Error(
      `[tamiz] Field '${field}': 'mustBeFuture' and 'mustBePast' cannot both be true — no date can satisfy both`,
    );
  }

  return rules;
}

function normalizeExemptions(raw: unknown): ExemptionRule[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new Error("[tamiz] 'exemptions' must be an array when defined");
  }

  return raw.map((entry, index) => {
    const parseResult = exemptionSchema.safeParse(entry);
    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0];
      const path = firstIssue.path.join(".");
      if (path === "field") {
        throw new Error(`[tamiz] exemptions[${index}].field must be a non-empty string`);
      }
      if (path.startsWith("values")) {
        const valueIndex = firstIssue.path[1];
        if (typeof valueIndex === "number") {
          throw new Error(
            `[tamiz] exemptions[${index}].values[${valueIndex}] must be a scalar value`,
          );
        }
        throw new Error(`[tamiz] exemptions[${index}].values must be a non-empty array`);
      }
      if (!isPlainObject(entry)) {
        throw new Error(`[tamiz] exemptions[${index}] must be an object`);
      }
      throw new Error(`[tamiz] exemptions[${index}]: ${firstIssue.message}`);
    }

    return {
      field: parseResult.data.field,
      values: [...parseResult.data.values],
    };
  });
}

function throwOnBothValueLists(
  field: string,
  allowedValues: unknown[],
  blockedValues: unknown[],
): never {
  const overlap = allowedValues.filter((allowed) =>
    blockedValues.some((blocked) => Object.is(allowed, blocked)),
  );

  const overlapText = overlap.length > 0 ? ` Overlap: [${overlap.map(String).join(", ")}].` : "";

  throw new Error(
    `[tamiz] Field '${field}' defines both 'allowedValues' and 'blockedValues'. ` +
    `Remove one of the two value-list rules.` +
    overlapText,
  );
}

function assertNoDuplicates(
  field: string,
  key: "allowedValues" | "blockedValues",
  values: unknown[] | undefined,
  normalize: ((value: unknown) => unknown) | undefined = undefined,
): void {
  if (values === undefined) return;
  const seen = new Set<unknown>();
  const duplicates: unknown[] = [];
  for (const v of values) {
    const comparable = normalize ? normalize(v) : v;
    if (seen.has(comparable)) {
      if (!duplicates.includes(v)) duplicates.push(v);
    } else {
      seen.add(comparable);
    }
  }
  if (duplicates.length > 0) {
    throw new Error(
      `[tamiz] Field '${field}': '${key}' contains duplicate values: [${duplicates.map(String).join(", ")}]`,
    );
  }
}

function zodIssueToMessage(field: string, issue: z.ZodIssue): string {
  const path = issue.path.join(".");

  if (issue.code === "unrecognized_keys") {
    const keys = (issue as z.ZodUnrecognizedKeysIssue).keys;
    return `unknown rule '${keys[0]}'`;
  }

  if (path === "nullable") {
    return `'nullable' must be false or omitted`;
  }

  if (path === "minLength" || path === "maxLength" || path === "maxAgeDays") {
    const min = path === "maxLength" ? 0 : 1;
    return `'${path}' must be an integer >= ${min}`;
  }

  if (path === "min" || path === "max") {
    return `'${path}' must be a finite number`;
  }

  if (path === "caseSensitive" || path === "mustBe" || path === "mustBeFuture" || path === "mustBePast") {
    return `'${path}' must be a boolean`;
  }

  if (path === "after" || path === "before") {
    return `'${path}' must be a valid date string`;
  }

  if (path === "allowedValues" || path === "blockedValues") {
    if (issue.code === "too_small") return `'${path}' must not be empty`;
    return `'${path}' must be an array`;
  }

  if (path.startsWith("allowedValues.") || path.startsWith("blockedValues.")) {
    const [listKey, indexStr] = path.split(".");
    return `'${listKey}[${indexStr}]' must be a ${issue.message.toLowerCase()}`;
  }

  return issue.message;
}

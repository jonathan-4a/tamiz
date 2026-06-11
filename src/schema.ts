import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { z } from "zod";
import type {
  BooleanRules,
  DateRules,
  FieldRules,
  FieldType,
  NumberRules,
  StringRules,
} from "./types.js";

export type { BooleanRules, DateRules, FieldRules, FieldType, NumberRules, StringRules };

export type ExemptionRule = {
  field: string;
  values: (string | number | boolean | null)[];
};

export type FilterSchema = {
  advancedFilter: boolean;
  fields: Record<string, FieldRules>;
  exemptions: ExemptionRule[];
};

const nullable = z.literal(false).optional();

const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const stringRulesSchema = z
  .object({
    type: z.literal("string"),
    nullable,
    minLength: z.number().int().min(1).optional(),
    maxLength: z.number().int().min(0).optional(),
    caseSensitive: z.boolean().optional(),
    allowedValues: z.array(z.string()).nonempty().optional(),
    blockedValues: z.array(z.string()).nonempty().optional(),
  })
  .strict();

const numberRulesSchema = z
  .object({
    type: z.literal("number"),
    nullable,
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    allowedValues: z.array(z.number().finite()).nonempty().optional(),
    blockedValues: z.array(z.number().finite()).nonempty().optional(),
  })
  .strict();

const booleanRulesSchema = z
  .object({
    type: z.literal("boolean"),
    nullable,
    mustBe: z.boolean().optional(),
  })
  .strict();

const dateRulesSchema = z
  .object({
    type: z.literal("date"),
    nullable,
    after: z.string().optional(),
    before: z.string().optional(),
    maxAgeDays: z.number().int().min(1).optional(),
    mustBeFuture: z.boolean().optional(),
    mustBePast: z.boolean().optional(),
  })
  .strict();

const fieldRulesSchema = z
  .discriminatedUnion("type", [
    stringRulesSchema,
    numberRulesSchema,
    booleanRulesSchema,
    dateRulesSchema,
  ])
  .superRefine((rules, ctx) => {
    switch (rules.type) {
      case "string":
        validateStringRules(rules, ctx);
        break;
      case "number":
        validateNumberRules(rules, ctx);
        break;
      case "date":
        validateDateRules(rules, ctx);
        break;
    }
  });

function validateStringRules(
  rules: z.infer<typeof stringRulesSchema>,
  ctx: z.RefinementCtx,
): void {
  const { minLength, maxLength, allowedValues, blockedValues, caseSensitive } = rules;

  if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
    ctx.addIssue({ code: "custom", message: `'minLength' (${minLength}) must not exceed 'maxLength' (${maxLength})` });
  }

  if (allowedValues !== undefined && blockedValues !== undefined) {
    const overlap = allowedValues.filter((a) => blockedValues.some((b) => Object.is(a, b)));
    const overlapText = overlap.length > 0 ? ` Overlap: [${overlap.map((v) => `'${v}'`).join(", ")}].` : "";
    ctx.addIssue({ code: "custom", message: `cannot define both 'allowedValues' and 'blockedValues'. Remove one.${overlapText}` });
  }

  const norm = caseSensitive === false ? (v: string) => v.toLowerCase() : (v: string) => v;

  for (const [key, list] of [["allowedValues", allowedValues], ["blockedValues", blockedValues]] as const) {
    if (list === undefined) continue;
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const v of list) {
      const k = norm(v);
      if (seen.has(k)) { if (!dupes.includes(v)) dupes.push(v); }
      else seen.add(k);
    }
    if (dupes.length > 0) {
      ctx.addIssue({ code: "custom", message: `'${key}' contains duplicate values: [${dupes.map((v) => `'${v}'`).join(", ")}]` });
    }
  }

  if (allowedValues !== undefined) {
    if (minLength !== undefined) {
      const tooShort = allowedValues.filter((v) => v.length < minLength);
      if (tooShort.length > 0) {
        ctx.addIssue({ code: "custom", message: `'allowedValues' entries shorter than minLength (${minLength}): [${tooShort.map((v) => `'${v}'`).join(", ")}]` });
      }
    }
    if (maxLength !== undefined) {
      const tooLong = allowedValues.filter((v) => v.length > maxLength);
      if (tooLong.length > 0) {
        ctx.addIssue({ code: "custom", message: `'allowedValues' entries longer than maxLength (${maxLength}): [${tooLong.map((v) => `'${v}'`).join(", ")}]` });
      }
    }
  }
}

function validateNumberRules(
  rules: z.infer<typeof numberRulesSchema>,
  ctx: z.RefinementCtx,
): void {
  const { min, max, allowedValues, blockedValues } = rules;

  if (min !== undefined && max !== undefined && min > max) {
    ctx.addIssue({ code: "custom", message: `'min' (${min}) must not exceed 'max' (${max})` });
  }

  if (allowedValues !== undefined && blockedValues !== undefined) {
    const overlap = allowedValues.filter((a) => blockedValues.some((b) => Object.is(a, b)));
    const overlapText = overlap.length > 0 ? ` Overlap: [${overlap.join(", ")}].` : "";
    ctx.addIssue({ code: "custom", message: `cannot define both 'allowedValues' and 'blockedValues'. Remove one.${overlapText}` });
  }

  for (const [key, list] of [["allowedValues", allowedValues], ["blockedValues", blockedValues]] as const) {
    if (list === undefined) continue;
    const dupes = list.filter((v, i) => list.indexOf(v) !== i);
    if (dupes.length > 0) {
      ctx.addIssue({ code: "custom", message: `'${key}' contains duplicate values: [${dupes.join(", ")}]` });
    }
  }

  if (allowedValues !== undefined) {
    const outOfRange = allowedValues.filter(
      (v) => (min !== undefined && v < min) || (max !== undefined && v > max),
    );
    if (outOfRange.length > 0) {
      ctx.addIssue({ code: "custom", message: `'allowedValues' entries outside min/max range: [${outOfRange.join(", ")}]` });
    }
  }
}

function validateDateRules(
  rules: z.infer<typeof dateRulesSchema>,
  ctx: z.RefinementCtx,
): void {
  const { after, before, mustBeFuture, mustBePast } = rules;

  if (after !== undefined && Number.isNaN(new Date(after).getTime())) {
    ctx.addIssue({ code: "custom", path: ["after"], message: "'after' must be a valid date string" });
  }
  if (before !== undefined && Number.isNaN(new Date(before).getTime())) {
    ctx.addIssue({ code: "custom", path: ["before"], message: "'before' must be a valid date string" });
  }
  if (after !== undefined && before !== undefined && new Date(after) >= new Date(before)) {
    ctx.addIssue({ code: "custom", message: "'after' must be earlier than 'before'" });
  }
  if (mustBeFuture === true && mustBePast === true) {
    ctx.addIssue({ code: "custom", message: "'mustBeFuture' and 'mustBePast' cannot both be true — no date can satisfy both" });
  }
}

const exemptionSchema = z.object({
  field: z.string().min(1, { message: "exemption 'field' must be a non-empty string" }),
  values: z.array(scalar).nonempty({ message: "exemption 'values' must be a non-empty array" }),
});

const configSchema = z.object({
  tamiz: z
    .object({
      advancedFilter: z.boolean().optional(),
      fields: z.record(z.string().min(1), z.unknown()),
      exemptions: z.array(z.unknown()).optional(),
    })
    .strict(),
});

/** Parse a schema from a plain JavaScript object. The object must contain a top-level `tamiz` key wrapping the config. */
export function loadSchemaFromObject(config: object): FilterSchema {
  return parse(config);
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

  let raw: unknown;
  try {
    raw = yaml.load(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[tamiz] Invalid YAML: ${message}`);
  }

  return parse(raw);
}

function parse(raw: unknown): FilterSchema {
  const configResult = configSchema.safeParse(raw);
  if (!configResult.success) {
    const issue = configResult.error.issues[0];
    const path = issue.path.join(".");
    if (path === "" || path === "tamiz") {
      throw new Error("[tamiz] Schema must be an object with a top-level 'tamiz' key containing a 'fields' object");
    }
    throw new Error(`[tamiz] ${issue.message}`);
  }

  const { advancedFilter, fields: rawFields, exemptions: rawExemptions } = configResult.data.tamiz;

  const fields: Record<string, FieldRules> = {};
  for (const [field, rawRules] of Object.entries(rawFields)) {
    const result = fieldRulesSchema.safeParse(rawRules);
    if (!result.success) {
      const issue = result.error.issues[0];
      throw new Error(`[tamiz] Field '${field}': ${issue.message}`);
    }
    fields[field] = result.data as FieldRules;
  }

  const exemptions: ExemptionRule[] = (rawExemptions ?? []).map((entry, index) => {
    const result = exemptionSchema.safeParse(entry);
    if (!result.success) {
      const issue = result.error.issues[0];
      throw new Error(`[tamiz] exemptions[${index}]: ${issue.message}`);
    }
    return { field: result.data.field, values: [...result.data.values] };
  });

  return {
    advancedFilter: advancedFilter === true,
    fields,
    exemptions,
  };
}
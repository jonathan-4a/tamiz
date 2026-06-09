import { z } from "zod";
import { AdvancedFilterError, FilterRegistry } from "./advanced-filter.js";
import type { AdvancedFilter } from "./advanced-filter.js";
import type { FilterSchema, ExemptionRule } from "./schema.js";
import type {
  EvaluateOptions,
  FilterResult,
  GateWarning,
  RuleFailure,
  WarningHandler,
} from "./types.js";
import { fail, pass } from "./types.js";
import { evaluateString } from "./rules/string.js";
import { evaluateNumber } from "./rules/number.js";
import { evaluateBoolean } from "./rules/boolean.js";
import { evaluateDate } from "./rules/date.js";
import { actualType, assertPlainRecord, hasOwn, isPlainObject } from "./util.js";

/** Options for constructing a {@link FilterEngine}. */
export type FilterEngineOptions = {
  /** The parsed schema (from {@link loadSchemaFromObject} or {@link loadSchemaFromFile}). */
  schema: FilterSchema;
  /** Optional registry of advanced filter functions that run after field rules pass. */
  filterRegistry?: FilterRegistry;
  /** Global warning handler called for every warning emitted during evaluation. */
  onWarning?: WarningHandler;
  /** When true, any field in the record not declared in the schema triggers a warning. */
  warnUnknownFields?: boolean;
};

const ruleFailureSchema = z.object({
  field: z.string().min(1),
  rule: z.string().min(1),
  message: z.string().min(1),
});

const advancedFilterResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: ruleFailureSchema }),
]);

/** The main entry point. Create an engine with a schema, then evaluate records against it. */
export class FilterEngine {
  private readonly schema: FilterSchema;
  private readonly filterRegistry: FilterRegistry | undefined;
  private readonly onWarning: WarningHandler | undefined;
  private readonly warnUnknownFields: boolean;

  /**
   * @param options - Engine configuration including the schema and optional advanced filters.
   */
  constructor(options: FilterEngineOptions) {
    if (options == null || options.schema == null) {
      throw new Error("[tamiz] FilterEngine requires a schema in the constructor.");
    }

    this.schema = options.schema;
    this.filterRegistry = normalizeFilterRegistry(options.filterRegistry);
    this.onWarning = options.onWarning;
    this.warnUnknownFields = options.warnUnknownFields === true;
  }

  /** Evaluate a single record against the schema. Returns pass or fail with details. */
  evaluate(
    record: Record<string, unknown>,
    options: EvaluateOptions = {},
  ): FilterResult {
    return this.evaluateRecord(record, options);
  }

  /** Evaluate multiple records in batch. Results are returned in the same order. */
  evaluateBatch(
    records: Record<string, unknown>[],
    options: EvaluateOptions = {},
  ): FilterResult[] {
    if (!Array.isArray(records)) {
      throw new Error(`[tamiz] records must be an array; received ${actualType(records)}.`);
    }

    return records.map((record) => this.evaluateRecord(record, options));
  }

  private evaluateRecord(
    record: Record<string, unknown>,
    options: EvaluateOptions,
  ): FilterResult {
    assertPlainRecord(record, "record");
    const exemption = findExemption(record, this.schema.exemptions);
    if (exemption !== null) {
      return pass([], "exempted");
    }

    const fieldResult = evaluateSchemaFields(record, this.schema, this.mergeOptions(options));
    if (!fieldResult.ok) return fieldResult;

    if (this.schema.advancedFilter !== true) return fieldResult;
    if (!this.filterRegistry || this.filterRegistry.size === 0) return fieldResult;

    for (const [index, filter] of this.filterRegistry.getAll().entries()) {
      const failure = this.runAdvancedFilter(filter, index, record);
      if (failure !== null) {
        return fail(failure, fieldResult.warnings);
      }
    }

    return fieldResult;
  }

  private mergeOptions(options: EvaluateOptions): EvaluateOptions {
    const merged: EvaluateOptions = {
      warnUnknownFields: options.warnUnknownFields ?? this.warnUnknownFields,
    };

    if (options.now !== undefined) merged.now = options.now;

    const onWarning = options.onWarning ?? this.onWarning;
    if (onWarning !== undefined) merged.onWarning = onWarning;

    return merged;
  }

  private runAdvancedFilter(
    filter: AdvancedFilter,
    filterIndex: number,
    record: Record<string, unknown>,
  ): RuleFailure | null {
    try {
      return validateAdvancedFilterResult(filter(record));
    } catch (error) {
      if (error instanceof AdvancedFilterError) throw error;
      throw new AdvancedFilterError(filterIndex, filter.name || undefined, error);
    }
  }
}

function evaluateSchemaFields(
  record: Record<string, unknown>,
  schema: FilterSchema,
  options: EvaluateOptions = {},
): FilterResult {
  assertValidNow(options.now);
  const warnings = collectBaseWarnings(record, schema, options);
  emitWarnings(warnings, options.onWarning);

  for (const [field, rules] of Object.entries(schema.fields)) {
    if (!hasOwn(record, field)) {
      throw new Error(`[tamiz] Record is missing required field '${field}'.`);
    }

    const value = record[field];
    let failure: RuleFailure | null = null;

    switch (rules.type) {
      case "string":
        failure = evaluateString(field, value, rules);
        break;
      case "number":
        failure = evaluateNumber(field, value, rules);
        break;
      case "boolean":
        failure = evaluateBoolean(field, value, rules);
        break;
      case "date":
        failure = evaluateDate(field, value, rules, options.now);
        break;
    }

    if (failure !== null) {
      return fail(failure, warnings);
    }
  }

  return pass(warnings);
}

function collectBaseWarnings(
  record: Record<string, unknown>,
  schema: FilterSchema,
  options: EvaluateOptions,
): GateWarning[] {
  const warnings: GateWarning[] = [];

  if (options.warnUnknownFields === true) {
    for (const [field, value] of Object.entries(record)) {
      if (!hasOwn(schema.fields, field)) {
        warnings.push({
          kind: "record",
          field,
          rule: "unknownField",
          value,
          message: `Field '${field}' is not declared in the rules config; it will not affect the gate.`,
        });
      }
    }
  }

  return warnings;
}

function emitWarnings(warnings: readonly GateWarning[], onWarning?: WarningHandler): void {
  if (!onWarning) return;
  for (const warning of warnings) onWarning(warning);
}

function assertValidNow(now: Date | undefined): void {
  if (now === undefined) return;
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error(`[tamiz] now must be a valid Date; received ${actualType(now)}.`);
  }
}

function validateAdvancedFilterResult(result: unknown): RuleFailure | null {
  if (!isPlainObject(result)) {
    throw new Error("[tamiz] Advanced filter must return { ok: true } or { ok: false, error }.");
  }

  const parseResult = advancedFilterResultSchema.safeParse(result);
  if (!parseResult.success) {
    const firstIssue = parseResult.error.issues[0];
    const path = firstIssue.path.join(".");

    if (path === "ok" || path === "") {
      throw new Error("[tamiz] Advanced filter result.ok must be true or false.");
    }
    if (path === "error" || path === "") {
      throw new Error("[tamiz] Advanced filter result.error must be a RuleFailure object.");
    }
    if (path === "error.field") {
      throw new Error("[tamiz] Advanced filter RuleFailure.field must be a non-empty string.");
    }
    if (path === "error.rule") {
      throw new Error("[tamiz] Advanced filter RuleFailure.rule must be a non-empty string.");
    }
    if (path === "error.message") {
      throw new Error("[tamiz] Advanced filter RuleFailure.message must be a non-empty string.");
    }
    throw new Error(`[tamiz] Advanced filter returned invalid result: ${firstIssue.message}`);
  }

  const data = parseResult.data;
  if (data.ok === true) return null;

  return {
    field: data.error.field,
    rule: data.error.rule,
    message: data.error.message,
  };
}

function normalizeFilterRegistry(
  filterRegistry: FilterRegistry | undefined,
): FilterRegistry | undefined {
  if (filterRegistry === undefined) return undefined;
  if (filterRegistry instanceof FilterRegistry) return filterRegistry;
  throw new Error("[tamiz] filterRegistry must be an instance of FilterRegistry.");
}

function findExemption(
  record: Record<string, unknown>,
  exemptions: readonly ExemptionRule[],
): ExemptionRule | null {
  for (const exemption of exemptions) {
    if (!hasOwn(record, exemption.field)) continue;
    const value = record[exemption.field];
    if (exemption.values.some((allowed) => Object.is(allowed, value))) {
      return exemption;
    }
  }

  return null;
}

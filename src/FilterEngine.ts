import { z } from "zod";
import { AdvancedFilterError, FilterRegistry } from "./AdvancedFilter.js";
import type { AdvancedFilter } from "./AdvancedFilter.js";
import type { FilterSchema, ExemptionRule } from "./schema.js";
import type {
  EvaluateOptions,
  EventHandler,
  FieldRules,
  FilterResult,
  RuleFailure,
  ScalarValue,
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
  /** Global event handler called for every event emitted during evaluation. */
  onEvent?: EventHandler;
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

function resolveConcurrency(value: number | undefined): number {
  if (value === undefined) return 1;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`[tamiz] concurrency must be a positive integer; received ${value}.`);
  }
  return value;
}

/** The main entry point. Create an engine with a schema, then evaluate records against it. */
export class FilterEngine {
  private readonly schema: FilterSchema;
  private readonly filterRegistry: FilterRegistry | undefined;
  private readonly onEvent: EventHandler | undefined;

  constructor(options: FilterEngineOptions) {
    if (options == null || options.schema == null) {
      throw new Error("[tamiz] FilterEngine requires a schema in the constructor.");
    }

    this.schema = options.schema;
    this.filterRegistry = normalizeFilterRegistry(options.filterRegistry);
    this.onEvent = options.onEvent;
  }

  /** Evaluate a single record against the schema. Returns pass or fail with details. */
  async evaluate(
    record: Record<string, unknown>,
    options: EvaluateOptions = {},
  ): Promise<FilterResult> {
    return this.evaluateRecord(record, options);
  }

  /** Evaluate multiple records in batch. Results are returned in the same order as the input.
   *
   * Concurrency is controlled by `options.concurrency` (default: 1 — fully sequential).
   * Raise it only when your advanced filters can safely handle parallel access to their
   * underlying resources (e.g. a DB pool sized to match, a thread-safe model server, etc.).
   */
  async evaluateBatch(
    records: Record<string, unknown>[],
    options: EvaluateOptions = {},
  ): Promise<FilterResult[]> {
    if (!Array.isArray(records)) {
      throw new Error(`[tamiz] records must be an array; received ${actualType(records)}.`);
    }

    const concurrency = resolveConcurrency(options.concurrency);
    const results: FilterResult[] = new Array(records.length);
    let next = 0;

    const worker = async (): Promise<void> => {
      while (next < records.length) {
        const index = next++;
        results[index] = await this.evaluateRecord(records[index], options);
      }
    };

    await Promise.all(Array.from({ length: concurrency }, worker));
    return results;
  }

  private async evaluateRecord(
    record: Record<string, unknown>,
    options: EvaluateOptions,
  ): Promise<FilterResult> {
    assertPlainRecord(record, "record");

    const onEvent = options.onEvent ?? this.onEvent;
    const now = options.now;

    assertValidNow(now);

    const exemption = findExemption(record, this.schema.exemptions);
    if (exemption !== null) {
      onEvent?.({ kind: "info", message: `Record was exempted by field '${exemption.field}'.` });
      return pass("exempted");
    }

    if (onEvent) {
      for (const field of Object.keys(record)) {
        if (!hasOwn(this.schema.fields, field)) {
          onEvent({ kind: "warning", message: `Field '${field}' is not declared in the schema and will not affect the gate.` });
        }
      }
    }

    const fieldResult = evaluateSchemaFields(record, this.schema, now);
    if (!fieldResult.ok) return fieldResult;

    if (this.schema.advancedFilter !== true) return fieldResult;
    if (!this.filterRegistry || this.filterRegistry.size === 0) return fieldResult;

    const failure = await this.runAdvancedFilters(
      this.filterRegistry.getAll(),
      record,
      onEvent,
    );
    if (failure !== null) return fail(failure);

    return fieldResult;
  }

  /** Run advanced filters sequentially, short-circuiting on the first failure. */
  private async runAdvancedFilters(
    filters: readonly AdvancedFilter[],
    record: Record<string, unknown>,
    onEvent: EventHandler | undefined,
  ): Promise<RuleFailure | null> {
    for (let index = 0; index < filters.length; index++) {
      const filter = filters[index];
      try {
        onEvent?.({ kind: "info", message: `Running advanced filter #${index}${filter.name ? ` (${filter.name})` : ""}.` });
        const result = validateAdvancedFilterResult(await filter(record, onEvent));
        if (result !== null) {
          onEvent?.({ kind: "info", message: `Advanced filter #${index}${filter.name ? ` (${filter.name})` : ""} rejected the record.` });
          return result;
        }
      } catch (error) {
        if (error instanceof AdvancedFilterError) throw error;
        throw new AdvancedFilterError(index, filter.name !== "" ? filter.name : undefined, error);
      }
    }
    return null;
  }
}

function evaluateSchemaFields(
  record: Record<string, unknown>,
  schema: FilterSchema,
  now: Date | undefined,
): FilterResult {
  for (const [field, rules] of Object.entries(schema.fields) as [string, FieldRules][]) {
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
        failure = evaluateDate(field, value, rules, now);
        break;
    }

    if (failure !== null) return fail(failure);
  }

  return pass();
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

    if (path === "ok") {
      throw new Error("[tamiz] Advanced filter result.ok must be true or false.");
    }
    if (path === "error") {
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
    if (exemption.values.some((allowed: ScalarValue) => Object.is(allowed, record[exemption.field]))) {
      return exemption;
    }
  }

  return null;
}
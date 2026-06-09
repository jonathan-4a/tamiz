/** Primitive value types a record field can hold. */
export type ScalarValue = string | number | boolean | null;

/** Supported field rule types. */
export type FieldType = "string" | "number" | "boolean" | "date";

export type BaseFieldRules<T extends FieldType> = {
  type: T;
  nullable?: false;
};

/** Rules for a string-typed field. */
export type StringRules = BaseFieldRules<"string"> & {
  minLength?: number;
  maxLength?: number;
  caseSensitive?: boolean;
  allowedValues?: string[];
  blockedValues?: string[];
};

/** Rules for a number-typed field. */
export type NumberRules = BaseFieldRules<"number"> & {
  min?: number;
  max?: number;
  allowedValues?: number[];
  blockedValues?: number[];
};

/** Rules for a boolean-typed field. */
export type BooleanRules = BaseFieldRules<"boolean"> & {
  mustBe?: boolean;
};

/** Rules for a date-typed field. */
export type DateRules = BaseFieldRules<"date"> & {
  after?: string;
  before?: string;
  maxAgeDays?: number;
  mustBeFuture?: boolean;
  mustBePast?: boolean;
};

/** Union of all field rule types. */
export type FieldRules = StringRules | NumberRules | BooleanRules | DateRules;

/** A rule that bypasses all field checks when the record's field matches one of the exempted values. */
export type ExemptionRule = {
  field: string;
  values: ScalarValue[];
};

/** Full parsed schema passed to {@link FilterEngine}. */
export type FilterSchema = {
  advancedFilter: boolean;
  readonly fields: Readonly<Record<string, FieldRules>>;
  readonly exemptions: readonly ExemptionRule[];
};

/** Details about why a record failed evaluation. */
export type RuleFailure = {
  field: string;
  rule: string;
  message: string;
};

/** A non-fatal warning emitted during evaluation (e.g. unknown fields). */
export type GateWarning = {
  kind: "record";
  field?: string;
  rule: string;
  message: string;
  value?: unknown;
};

/** The result of evaluating a record: either passed (with reason) or failed (with error details). */
export type FilterResult =
  | {
      ok: true;
      reason: "passed" | "exempted";
      warnings: GateWarning[];
    }
  | {
      ok: false;
      error: RuleFailure;
      warnings: GateWarning[];
    };

export function pass(warnings: GateWarning[] = [], reason: "passed" | "exempted" = "passed"): FilterResult {
  return { ok: true, reason, warnings };
}

export function fail(failure: RuleFailure, warnings: GateWarning[] = []): FilterResult {
  return {
    ok: false,
    error: failure,
    warnings,
  };
}

/** Callback invoked for each non-fatal warning during evaluation. */
export type WarningHandler = (warning: GateWarning) => void;

/** Per-call options for {@link FilterEngine.evaluate} and {@link FilterEngine.evaluateBatch}. */
export type EvaluateOptions = {
  now?: Date;
  onWarning?: WarningHandler;
  warnUnknownFields?: boolean;
};

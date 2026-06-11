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

/** Details about why a record failed evaluation. */
export type RuleFailure = {
  field: string;
  rule: string;
  message: string;
};

/** The result of evaluating a record: either passed (with reason) or failed (with error details). */
export type FilterResult =
  | { ok: true;  reason: "passed" | "exempted" }
  | { ok: false; error: RuleFailure };

export function pass(reason: "passed" | "exempted" = "passed"): FilterResult {
  return { ok: true, reason };
}

export function fail(failure: RuleFailure): FilterResult {
  return { ok: false, error: failure };
}

/** An event emitted by the engine during evaluation. */
export type EngineEvent =
  | { kind: "warning"; message: string }
  | { kind: "info";    message: string };

/** Callback invoked for each event emitted during evaluation. */
export type EventHandler = (event: EngineEvent) => void;

/** Per-call options for {@link FilterEngine.evaluate} and {@link FilterEngine.evaluateBatch}. */
export type EvaluateOptions = {
  now?: Date;
  onEvent?: EventHandler;
};
import type { RuleFailure } from "./types.js";

/** Result returned by an {@link AdvancedFilter} function. */
export type AdvancedFilterResult =
  | { ok: true }
  | { ok: false; error: RuleFailure };

/** A custom filter function for logic beyond per-field rules. Runs after all field rules pass. */
export type AdvancedFilter = (record: Record<string, unknown>) => AdvancedFilterResult;

/** Thrown when an advanced filter throws an unexpected error during evaluation. */
export class AdvancedFilterError extends Error {
  readonly filterIndex: number;
  readonly filterName: string | undefined;

  constructor(filterIndex: number, filterName: string | undefined, cause: unknown) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    const label = filterName ? ` #${filterIndex} (${filterName})` : ` #${filterIndex}`;
    super(`[tamiz] Advanced filter${label} failed: ${causeMessage}`, { cause });
    this.name = "AdvancedFilterError";
    this.filterIndex = filterIndex;
    if (filterName !== undefined) this.filterName = filterName;
  }
}

/** Register and manage advanced filter functions used by {@link FilterEngine}. */
export class FilterRegistry {
  private readonly filters: AdvancedFilter[] = [];
  private snapshot: readonly AdvancedFilter[] = Object.freeze([]);

  /** Register an advanced filter function. Returns `this` for chaining. */
  register(filter: AdvancedFilter): this {
    if (typeof filter !== "function") {
      throw new Error("[tamiz] Advanced filter must be a function");
    }

    this.filters.push(filter);
    this.refreshSnapshot();
    return this;
  }

  /** Get all registered filters as a frozen array snapshot. */
  getAll(): readonly AdvancedFilter[] {
    return this.snapshot;
  }

  /** Remove all registered filters. Returns `this` for chaining. */
  clear(): this {
    this.filters.length = 0;
    this.refreshSnapshot();
    return this;
  }

  /** Number of registered filters. */
  get size(): number {
    return this.filters.length;
  }

  private refreshSnapshot(): void {
    this.snapshot = Object.freeze([...this.filters]);
  }
}

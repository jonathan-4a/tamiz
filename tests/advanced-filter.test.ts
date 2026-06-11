import { describe, test, expect } from "vitest";
import { AdvancedFilterError, FilterEngine, FilterRegistry, loadSchemaFromObject } from "../src/index.js";
import { expectMissingField, NOW } from "./helpers.js";

const OPT = { now: NOW };

function makeAdvancedEngine(
  condition: (r: any) => boolean,
  opts: { advancedFilter?: boolean } = {},
): FilterEngine {
  const registry = new FilterRegistry();
  registry.register((record: any) => {
    const result = condition(record);
    if (result === false) return { ok: true };
    return {
      ok: false,
      error: { field: "x", rule: "customFail", message: "Custom rule failed." },
    };
  });

  const schema = loadSchemaFromObject({
    tamiz: {
      fields: { x: { type: "string" } },
      advancedFilter: opts.advancedFilter !== false,
    },
  } as any);

  return new FilterEngine({
    schema,
    filterRegistry: registry,
  });
}

describe("FilterRegistry", () => {
  test("register returns this for chaining", () => {
    const r = new FilterRegistry();
    expect(r.register(() => ({ ok: true }))).toBe(r);
  });

  test("size reflects registered filter count", () => {
    const r = new FilterRegistry();
    expect(r.size).toBe(0);
    r.register(() => ({ ok: true }));
    expect(r.size).toBe(1);
  });

  test("clear removes all filters and returns this", () => {
    const r = new FilterRegistry();
    r.register(() => ({ ok: true })).register(() => ({ ok: true }));
    const result = r.clear();
    expect(r.size).toBe(0);
    expect(result).toBe(r);
  });

  test("getAll reuses a snapshot until the registry changes", () => {
    const r = new FilterRegistry();
    const firstFilter = () => ({ ok: true } as const);
    const secondFilter = () => ({ ok: true } as const);

    const emptySnapshot = r.getAll();
    expect(r.getAll()).toBe(emptySnapshot);

    r.register(firstFilter);
    const oneFilterSnapshot = r.getAll();
    expect(oneFilterSnapshot).not.toBe(emptySnapshot);
    expect(r.getAll()).toBe(oneFilterSnapshot);
    expect(oneFilterSnapshot).toEqual([firstFilter]);

    r.register(secondFilter);
    expect(r.getAll()).toEqual([firstFilter, secondFilter]);

    r.clear();
    expect(r.getAll()).toEqual([]);
  });

  test("throws when registering a non-function", () => {
    expect(() => new FilterRegistry().register("not-a-fn" as any)).toThrow();
  });
});

describe("Advanced filters — basic behaviour", () => {
  test("filter returning ok:true passes the record", async () => {
    const eng = makeAdvancedEngine(() => false);
    const r = await eng.evaluate({ x: "ok" }, OPT);
    expect(r.ok).toBe(true);
  });

  test("filter returning ok:false fails the record", async () => {
    const eng = makeAdvancedEngine(() => true);
    const r = await eng.evaluate({ x: "ok" }, OPT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.rule).toBe("customFail");
  });

  test("advanced filters do NOT run when advancedFilter flag is false", async () => {
    let ran = false;
    const eng = makeAdvancedEngine(() => { ran = true; return true; }, { advancedFilter: false });
    const r = await eng.evaluate({ x: "ok" }, OPT);
    expect(r.ok).toBe(true);
    expect(ran).toBe(false);
  });

  test("advanced filter only runs after built-in rules pass", async () => {
    let ran = false;
    const registry = new FilterRegistry();
    registry.register(() => { ran = true; return { ok: true }; });
    const schema = loadSchemaFromObject({
      tamiz: { fields: { x: { type: "string", nullable: false } }, advancedFilter: true },
    } as any);
    const eng = new FilterEngine({ schema, filterRegistry: registry });

    await expectMissingField(() => eng.evaluate({}, OPT), "x");
    expect(ran).toBe(false);
  });
});

describe("Advanced filters — multiple filters", () => {
  test("returns the first failing filter in registration order", async () => {
    const registry = new FilterRegistry();
    registry.register(() => ({
      ok: false,
      error: { field: "x", rule: "first", message: "fail" },
    }));
    registry.register(() => ({
      ok: false,
      error: { field: "x", rule: "second", message: "fail" },
    }));

    const schema = loadSchemaFromObject({
      tamiz: { fields: { x: { type: "string" } }, advancedFilter: true },
    } as any);
    const eng = new FilterEngine({ schema, filterRegistry: registry });
    const r = await eng.evaluate({ x: "val" }, OPT);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.rule).toBe("first");
  });

  test("all filters passing still results in ok:true", async () => {
    const registry = new FilterRegistry();
    registry.register(() => ({ ok: true }));
    registry.register(() => ({ ok: true }));
    const schema = loadSchemaFromObject({
      tamiz: { fields: { x: { type: "string" } }, advancedFilter: true },
    } as any);
    const r = await new FilterEngine({ schema, filterRegistry: registry }).evaluate({ x: "ok" }, OPT);
    expect(r.ok).toBe(true);
  });
});

describe("Advanced filters — exceptions", () => {
  function makeCrashingEngine(): FilterEngine {
    const registry = new FilterRegistry();
    registry.register(function crashingFilter() { throw new Error("crash"); });
    const schema = loadSchemaFromObject({
      tamiz: { fields: { x: { type: "string" } }, advancedFilter: true },
    } as any);
    return new FilterEngine({
      schema, filterRegistry: registry,
    });
  }

  test("callback exception throws AdvancedFilterError with filter metadata", async () => {
    try {
      await makeCrashingEngine().evaluate({ x: "val" }, OPT);
      throw new Error("expected evaluate to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AdvancedFilterError);
      expect((error as AdvancedFilterError).filterIndex).toBe(0);
      expect((error as AdvancedFilterError).filterName).toBe("crashingFilter");
      expect((error as Error).message).toContain("crash");
      expect((error as Error).cause).toBeInstanceOf(Error);
    }
  });
});

describe("Advanced filters — invalid return values", () => {
  function makeReturningEngine(returnValue: unknown): FilterEngine {
    const registry = new FilterRegistry();
    registry.register(() => returnValue as any);
    const schema = loadSchemaFromObject({
      tamiz: { fields: { x: { type: "string" } }, advancedFilter: true },
    } as any);
    return new FilterEngine({ schema, filterRegistry: registry });
  }

  test("returning null throws AdvancedFilterError", async () => {
    await expect(makeReturningEngine(null).evaluate({ x: "val" }, OPT)).rejects.toThrow(AdvancedFilterError);
  });

  test("returning non-object throws AdvancedFilterError", async () => {
    await expect(makeReturningEngine("oops").evaluate({ x: "val" }, OPT)).rejects.toThrow(AdvancedFilterError);
  });

  test("returning ok:false with empty error field throws AdvancedFilterError", async () => {
    await expect(
      makeReturningEngine({ ok: false, error: { field: "", rule: "r", message: "m" } }).evaluate({ x: "val" }, OPT),
    ).rejects.toThrow(AdvancedFilterError);
  });

  test("returning ok:false with missing error rule throws AdvancedFilterError", async () => {
    await expect(
      makeReturningEngine({ ok: false, error: { field: "x", message: "m" } }).evaluate({ x: "val" }, OPT),
    ).rejects.toThrow(AdvancedFilterError);
  });
});

describe("Advanced filters — cross-field validation", () => {
  test("filter can enforce cross-field constraint", async () => {
    const registry = new FilterRegistry();
    registry.register((record: any) => {
      if (record.endDate <= record.startDate) {
        return {
          ok: false,
          error: { field: "endDate", rule: "endBeforeStart", message: "endDate must be after startDate" },
        };
      }
      return { ok: true };
    });
    const schema = loadSchemaFromObject({
      tamiz: {
        fields: {
          startDate: { type: "date", nullable: false },
          endDate: { type: "date", nullable: false },
        },
        advancedFilter: true,
      },
    } as any);
    const eng = new FilterEngine({ schema, filterRegistry: registry });

    const start = new Date("2024-01-01");
    const valid = new Date("2024-01-10");
    const invalid = new Date("2023-12-01");

    const pass = await eng.evaluate({ startDate: start, endDate: valid }, OPT);
    expect(pass.ok).toBe(true);

    const fail = await eng.evaluate({ startDate: start, endDate: invalid }, OPT);
    expect(fail.ok).toBe(false);
    if (!fail.ok) expect(fail.error.rule).toBe("endBeforeStart");
  });
});

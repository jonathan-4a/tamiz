import { describe, it, expect, vi } from "vitest";
import { FilterEngine, FilterRegistry, loadSchemaFromObject } from "../src/index.js";

function loadSchema(tamiz: Record<string, unknown>) {
  return loadSchemaFromObject({ tamiz } as Parameters<typeof loadSchemaFromObject>[0]);
}

describe("FilterEngine constructor", () => {
  it("throws when constructed without a schema", () => {
    expect(() => new FilterEngine(undefined as any)).toThrow("requires a schema");
  });

  it("throws when filterRegistry is not a FilterRegistry instance", () => {
    expect(() =>
      new FilterEngine({
        schema: loadSchema({ fields: { x: { type: "string" } } }),
        filterRegistry: {} as FilterRegistry,
      }),
    ).toThrow("FilterRegistry");
  });

});

describe("evaluate", () => {
  it("throws when record is null, undefined, array, or string", () => {
    const eng = new FilterEngine({ schema: loadSchema({ fields: { x: { type: "string" } } }) });
    expect(() => eng.evaluate(null as any)).toThrow();
    expect(() => eng.evaluate(undefined as any)).toThrow();
    expect(() => eng.evaluate([] as any)).toThrow();
    expect(() => eng.evaluate("bad" as any)).toThrow();
  });

  it("throws when now is not a valid Date", () => {
    const eng = new FilterEngine({ schema: loadSchema({ fields: { x: { type: "string" } } }) });
    expect(() => eng.evaluate({ x: "ok" }, { now: "2024-01-01" as any })).toThrow();
  });

  it("result always contains a warnings array", () => {
    const eng = new FilterEngine({ schema: loadSchema({ fields: { name: { type: "string", nullable: false } } }) });
    const pass = eng.evaluate({ name: "Alice" });
    const fail = eng.evaluate({ name: "" });
    expect(Array.isArray(pass.warnings)).toBe(true);
    expect(Array.isArray(fail.warnings)).toBe(true);
  });

  it("passing result has reason 'passed'", () => {
    const eng = new FilterEngine({ schema: loadSchema({ fields: { x: { type: "string" } } }) });
    const r = eng.evaluate({ x: "ok" }) as any;
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("passed");
  });
});

describe("evaluate — unknown fields / warnUnknownFields", () => {
  const schema = loadSchema({ fields: { name: { type: "string", nullable: false } } });

  it("silently ignores unknown fields by default", () => {
    const eng = new FilterEngine({ schema });
    const r = eng.evaluate({ name: "Alice", extra: true });
    expect(r.ok).toBe(true);
    expect(r.warnings.filter(w => w.rule === "unknownField")).toHaveLength(0);
  });

  it("emits unknownField warning when engine-level warnUnknownFields is true", () => {
    const eng = new FilterEngine({ schema, warnUnknownFields: true });
    const r = eng.evaluate({ name: "Alice", a: 1, b: 2 });
    const unknown = r.warnings.filter(w => w.rule === "unknownField");
    expect(unknown).toHaveLength(2);
    expect(unknown[0]).toMatchObject({ kind: "record", rule: "unknownField" });
    expect(unknown[0]?.message).toContain(unknown[0]?.field);
  });

  it("per-call warnUnknownFields:true overrides engine-level false", () => {
    const eng = new FilterEngine({ schema, warnUnknownFields: false });
    const r = eng.evaluate({ name: "Alice", extra: "x" }, { warnUnknownFields: true });
    expect(r.warnings.some(w => w.rule === "unknownField")).toBe(true);
  });

  it("per-call warnUnknownFields:false overrides engine-level true", () => {
    const eng = new FilterEngine({ schema, warnUnknownFields: true });
    const r = eng.evaluate({ name: "Alice", extra: "x" }, { warnUnknownFields: false });
    expect(r.warnings.some(w => w.rule === "unknownField")).toBe(false);
  });
});

describe("evaluate — onWarning callback", () => {
  it("engine-level onWarning is called for each warning", () => {
    const onWarning = vi.fn();
    const schema = loadSchema({ fields: { name: { type: "string", nullable: false } } });
    const eng = new FilterEngine({ schema, onWarning, warnUnknownFields: true });
    eng.evaluate({ name: "Alice", extra: true });
    expect(onWarning).toHaveBeenCalled();
    expect(onWarning.mock.calls[0][0]).toMatchObject({ rule: "unknownField" });
  });

  it("per-call onWarning overrides engine-level callback", () => {
    const engineCb = vi.fn();
    const callCb = vi.fn();
    const schema = loadSchema({ fields: { name: { type: "string", nullable: false } } });
    const eng = new FilterEngine({ schema, onWarning: engineCb, warnUnknownFields: true });
    eng.evaluate({ name: "Alice", extra: true }, { onWarning: callCb });
    expect(callCb).toHaveBeenCalled();
    expect(engineCb).not.toHaveBeenCalled();
  });
});

describe("evaluate — field ordering", () => {
  it("throws for the first missing field in declaration order", () => {
    const eng = new FilterEngine({
      schema: loadSchema({ fields: { a: { type: "string", nullable: false }, b: { type: "string", nullable: false } } }),
    });
    expect(() => eng.evaluate({ b: "ok" })).toThrow("missing required field 'a'");
  });
});

describe("evaluate — type mismatch across all field types", () => {
  const schema = loadSchema({
    fields: { s: { type: "string" }, n: { type: "number" }, b: { type: "boolean" }, d: { type: "date" } },
  });
  const eng = new FilterEngine({ schema });

  it("rejects wrong type for each field type", () => {
    expect(() => eng.evaluate({ s: 42 })).toThrow();
    expect(() => eng.evaluate({ s: "ok", n: "hello" })).toThrow();
    expect(() => eng.evaluate({ s: "ok", n: 1, b: 1 })).toThrow();
    expect(() => eng.evaluate({ s: "ok", n: 1, b: true, d: "2024-01-01" })).toThrow();
  });
});

describe("evaluateBatch", () => {
  const schema = loadSchema({ fields: { n: { type: "number", nullable: false } } });
  const eng = new FilterEngine({ schema });

  it("throws when records is not an array", () => {
    expect(() => eng.evaluateBatch(null as any)).toThrow("array");
  });

  it("returns empty array for empty batch", () => {
    expect(eng.evaluateBatch([])).toEqual([]);
  });

  it("throws when any batch record is missing a declared field", () => {
    expect(() => eng.evaluateBatch([{ n: 1 }, {}, { n: 3 }])).toThrow("missing required field 'n'");
  });

  it("uses the constructor schema for every record in the batch", () => {
    expect(() => eng.evaluateBatch([{ y: 1 }])).toThrow("missing required field 'n'");
  });
});

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
  it("throws when record is null, undefined, array, or string", async () => {
    const eng = new FilterEngine({ schema: loadSchema({ fields: { x: { type: "string" } } }) });
    await expect(eng.evaluate(null as any)).rejects.toThrow();
    await expect(eng.evaluate(undefined as any)).rejects.toThrow();
    await expect(eng.evaluate([] as any)).rejects.toThrow();
    await expect(eng.evaluate("bad" as any)).rejects.toThrow();
  });

  it("throws when now is not a valid Date", async () => {
    const eng = new FilterEngine({ schema: loadSchema({ fields: { x: { type: "string" } } }) });
    await expect(eng.evaluate({ x: "ok" }, { now: "2024-01-01" as any })).rejects.toThrow();
  });

  it("result has ok and reason, no warnings property", async () => {
    const eng = new FilterEngine({ schema: loadSchema({ fields: { name: { type: "string", nullable: false } } }) });
    const pass = await eng.evaluate({ name: "Alice" });
    const fail = await eng.evaluate({ name: "" });
    expect(pass).not.toHaveProperty("warnings");
    expect(fail).not.toHaveProperty("warnings");
  });

  it("passing result has reason 'passed'", async () => {
    const eng = new FilterEngine({ schema: loadSchema({ fields: { x: { type: "string" } } }) });
    const r = await eng.evaluate({ x: "ok" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reason).toBe("passed");
  });
});

describe("evaluate — unknown fields", () => {
  const schema = loadSchema({ fields: { name: { type: "string", nullable: false } } });

  it("emits warning event for unknown fields when onEvent is provided", async () => {
    const events: unknown[] = [];
    const eng = new FilterEngine({ schema, onEvent: (e) => events.push(e) });
    const r = await eng.evaluate({ name: "Alice", extra: true });
    expect(r.ok).toBe(true);
    expect(events.some((e: any) => e.kind === "warning" && e.message.includes("extra"))).toBe(true);
  });

  it("emits one warning per unknown field", async () => {
    const events: unknown[] = [];
    const eng = new FilterEngine({ schema, onEvent: (e) => events.push(e) });
    await eng.evaluate({ name: "Alice", a: 1, b: 2 });
    const warnings = (events as any[]).filter((e) => e.kind === "warning");
    expect(warnings).toHaveLength(2);
  });

  it("per-call onEvent overrides engine-level onEvent", async () => {
    const engineEvents: unknown[] = [];
    const callEvents: unknown[] = [];
    const eng = new FilterEngine({ schema, onEvent: (e) => engineEvents.push(e) });
    await eng.evaluate({ name: "Alice", extra: "x" }, { onEvent: (e) => callEvents.push(e) });
    expect(callEvents.some((e: any) => e.kind === "warning")).toBe(true);
    expect(engineEvents).toHaveLength(0);
  });

  it("no onEvent set — unknown fields are silently ignored", async () => {
    const eng = new FilterEngine({ schema });
    await expect(eng.evaluate({ name: "Alice", extra: true })).resolves.toMatchObject({ ok: true });
  });
});

describe("evaluate — onEvent callback", () => {
  it("engine-level onEvent is called for unknown field warnings", async () => {
    const onEvent = vi.fn();
    const schema = loadSchema({ fields: { name: { type: "string", nullable: false } } });
    const eng = new FilterEngine({ schema, onEvent });
    await eng.evaluate({ name: "Alice", extra: true });
    expect(onEvent).toHaveBeenCalled();
    expect(onEvent.mock.calls[0][0]).toMatchObject({ kind: "warning" });
  });

  it("per-call onEvent overrides engine-level callback", async () => {
    const engineCb = vi.fn();
    const callCb = vi.fn();
    const schema = loadSchema({ fields: { name: { type: "string", nullable: false } } });
    const eng = new FilterEngine({ schema, onEvent: engineCb });
    await eng.evaluate({ name: "Alice", extra: true }, { onEvent: callCb });
    expect(callCb).toHaveBeenCalled();
    expect(engineCb).not.toHaveBeenCalled();
  });
});

describe("evaluate — field ordering", () => {
  it("throws for the first missing field in declaration order", async () => {
    const eng = new FilterEngine({
      schema: loadSchema({ fields: { a: { type: "string", nullable: false }, b: { type: "string", nullable: false } } }),
    });
    await expect(eng.evaluate({ b: "ok" })).rejects.toThrow("missing required field 'a'");
  });
});

describe("evaluate — type mismatch across all field types", () => {
  const schema = loadSchema({
    fields: { s: { type: "string" }, n: { type: "number" }, b: { type: "boolean" }, d: { type: "date" } },
  });
  const eng = new FilterEngine({ schema });

  it("rejects wrong type for each field type", async () => {
    await expect(eng.evaluate({ s: 42 })).rejects.toThrow();
    await expect(eng.evaluate({ s: "ok", n: "hello" })).rejects.toThrow();
    await expect(eng.evaluate({ s: "ok", n: 1, b: 1 })).rejects.toThrow();
    await expect(eng.evaluate({ s: "ok", n: 1, b: true, d: "2024-01-01" })).rejects.toThrow();
  });
});

describe("evaluateBatch", () => {
  const schema = loadSchema({ fields: { n: { type: "number", nullable: false } } });
  const eng = new FilterEngine({ schema });

  it("throws when records is not an array", async () => {
    await expect(eng.evaluateBatch(null as any)).rejects.toThrow("array");
  });

  it("returns empty array for empty batch", async () => {
    await expect(eng.evaluateBatch([])).resolves.toEqual([]);
  });

  it("throws when any batch record is missing a declared field", async () => {
    await expect(eng.evaluateBatch([{ n: 1 }, {}, { n: 3 }])).rejects.toThrow("missing required field 'n'");
  });

  it("uses the constructor schema for every record in the batch", async () => {
    await expect(eng.evaluateBatch([{ y: 1 }])).rejects.toThrow("missing required field 'n'");
  });
});

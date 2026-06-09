/**
 * gaps.test.ts
 *
 * Covers behaviour that existing tests do not exercise. Each describe block
 * names the area it owns so there is no overlap with the existing test files
 * (string.test.ts, number.test.ts, date.test.ts, boolean.test.ts,
 * engine.test.ts, exemptions.test.ts, advanced-filter.test.ts, schema.test.ts).
 *
 * Organisation
 * ────────────
 * 1.  FilterResult shape — warnings present in every result variant
 * 2.  String — rule-evaluation order (nullable → minLength → maxLength → allowedValues/blockedValues)
 * 3.  String — caseSensitive:false with allowedValues, case-variant that is NOT in the list
 * 4.  String — caseSensitive:false with blockedValues, case-variant of an allowed value
 * 5.  Number — rule-evaluation order (nullable → min → max → allowedValues/blockedValues)
 * 6.  Number — allowedValues uses Object.is identity (not ==), so -0 vs 0 are treated as equal
 * 7.  Date — rule-evaluation order (nullable → after → before → maxAgeDays → mustBeFuture → mustBePast)
 * 8.  Date — Invalid Date object throws type mismatch
 * 9.  Multi-field schema — warnings survive into a failure result
 * 10. Multi-field schema — second field failure reported when first passes
 * 11. evaluateBatch — happy path (all pass, mixed pass/fail)
 * 12. evaluateBatch — warnings are returned per record
 * 13. warnUnknownFields — warning carries field name and value
 * 14. warnUnknownFields — record that fails a rule still has unknown-field warnings
 * 15. onWarning — per-call onWarning receives warnings before the result is returned
 * 16. Exemptions — bypass advanced filters entirely
 * 17. Exemptions — null is a valid exempt value (Object.is semantics)
 * 18. Exemptions — multiple exemption rules, first matching one wins
 * 19. Exemptions — exempt record always has empty warnings array
 * 20. Schema validation — duplicate allowedValues entries throw
 * 21. Schema validation — duplicate blockedValues entries throw
 * 22. Schema validation — duplicate caseSensitive blockedValues entries throw
 * 23. Schema validation — nullable:true throws (only false is meaningful)
 * 24. Schema validation — advancedFilter must be boolean
 * 25. Schema validation — exemptions array validation (empty values, non-scalar value, non-object entry)
 * 26. Schema validation — loadSchemaFromFile throws on non-existent file
 * 27. Schema validation — number allowedValues out-of-range when only one of min/max is set
 * 28. FilterRegistry — snapshot is immutable (frozen array)
 * 29. Advanced filters — registry with zero filters skips advanced stage even when flag is true
 * 30. Advanced filters — filter receives the original record unchanged
 * 31. Advanced filters — AdvancedFilterError exposes filterIndex and filterName correctly for anonymous filter
 */

import { describe, test, expect, vi } from "vitest";
import path from "path";
import {
  FilterEngine,
  FilterRegistry,
  AdvancedFilterError,
  loadSchemaFromObject,
  loadSchemaFromFile,
} from "../src/index.js";
import {
  makeEngine,
  loadSchema,
  expectPass,
  expectFail,
  expectExempted,
  expectMissingField,
  NOW,
  daysFromNow,
} from "./helpers.js";

const OPT = { now: NOW };

// ─────────────────────────────────────────────────────────────────────────────
// 1. FilterResult shape — warnings present in every result variant
// ─────────────────────────────────────────────────────────────────────────────
describe("FilterResult shape", () => {
  const eng = makeEngine({ name: { type: "string", nullable: false } });

  test("passing result: ok true, reason 'passed', warnings array", () => {
    const r = eng.evaluate({ name: "Alice" }) as any;
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("passed");
    expect(Array.isArray(r.warnings)).toBe(true);
  });

  test("failing result: ok false, error object present, warnings array", () => {
    const r = eng.evaluate({ name: "" }) as any;
    expect(r.ok).toBe(false);
    expect(r.error).toBeDefined();
    expect(r.error.field).toBe("name");
    expect(r.error.rule).toBe("nullable");
    expect(r.error.message).toBeTruthy();
    expect(Array.isArray(r.warnings)).toBe(true);
  });

  test("exempted result: ok true, reason 'exempted', warnings array", () => {
    const eng2 = makeEngine(
      { name: { type: "string", nullable: false } },
      { exemptions: [{ field: "role", values: ["admin"] }] },
    );
    const r = eng2.evaluate({ role: "admin" }) as any;
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("exempted");
    expect(Array.isArray(r.warnings)).toBe(true);
  });

  test("RuleFailure message is a non-empty string", () => {
    const r = eng.evaluate({ name: "" }) as any;
    expect(typeof r.error.message).toBe("string");
    expect(r.error.message.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. String — rule-evaluation order
// ─────────────────────────────────────────────────────────────────────────────
describe("String rule-evaluation order", () => {
  // nullable is checked before length rules
  test("nullable checked before minLength", () => {
    const eng = makeEngine({ s: { type: "string", nullable: false, minLength: 3 } });
    expectFail(eng.evaluate({ s: "" }), "s", "nullable");
    expectFail(eng.evaluate({ s: null }), "s", "nullable");
  });

  // minLength checked before maxLength (would only matter if both fire — impossible on the
  // same value, but we confirm the order by using a value that is too short AND too short
  // relative to max — the reported rule is minLength)
  test("minLength checked before blockedValues", () => {
    const eng = makeEngine({ s: { type: "string", nullable: false, minLength: 5, blockedValues: ["ab"] } });
    // "ab" violates minLength AND blockedValues; minLength should be reported
    expectFail(eng.evaluate({ s: "ab" }), "s", "minLength");
  });

  test("maxLength checked before allowedValues", () => {
    // value "toolong" is not in allowedValues and also exceeds maxLength:4
    const eng = makeEngine({ s: { type: "string", maxLength: 4, allowedValues: ["ok"] } });
    expectFail(eng.evaluate({ s: "toolong" }), "s", "maxLength");
  });

  test("allowedValues checked before blockedValues is unreachable when both present (schema rejects)", () => {
    // Confirm the schema itself rejects the combination rather than silently picking one rule
    expect(() =>
      makeEngine({ s: { type: "string", allowedValues: ["a"], blockedValues: ["b"] } }),
    ).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. String — caseSensitive:false with allowedValues edge cases
// ─────────────────────────────────────────────────────────────────────────────
describe("String caseSensitive:false with allowedValues — non-matching case variants", () => {
  const eng = makeEngine({ s: { type: "string", allowedValues: ["active", "inactive"], caseSensitive: false } });

  test("value that is a case-variant of an allowed entry passes", () => {
    expectPass(eng.evaluate({ s: "ACTIVE" }));
    expectPass(eng.evaluate({ s: "Inactive" }));
  });

  test("value that is not in the list at all still fails, regardless of case", () => {
    expectFail(eng.evaluate({ s: "pending" }), "s", "allowedValues");
    expectFail(eng.evaluate({ s: "PENDING" }), "s", "allowedValues");
  });

  test("empty string is treated as nullable (falls through before allowedValues check)", () => {
    // no nullable:false — empty string should pass
    expectPass(eng.evaluate({ s: "" }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. String — caseSensitive:false with blockedValues
//    The existing test confirms SPAM fails. Here we add: a value that shares no
//    letters with blocked values must pass, and we test multiple blocked entries.
// ─────────────────────────────────────────────────────────────────────────────
describe("String caseSensitive:false with blockedValues — broader coverage", () => {
  const eng = makeEngine({ s: { type: "string", blockedValues: ["spam", "junk"], caseSensitive: false } });

  test("exact match blocked", () => expectFail(eng.evaluate({ s: "spam" }), "s", "blockedValues"));
  test("uppercase variant of first blocked value blocked", () => expectFail(eng.evaluate({ s: "SPAM" }), "s", "blockedValues"));
  test("mixed-case variant of second blocked value blocked", () => expectFail(eng.evaluate({ s: "Junk" }), "s", "blockedValues"));
  test("value that is a prefix of a blocked value is NOT blocked", () => expectPass(eng.evaluate({ s: "spa" })));
  test("unrelated value passes", () => expectPass(eng.evaluate({ s: "hello" })));

  // case-insensitive blockedValues does NOT affect allowedValues behavior on separate engine
  test("caseSensitive:false on blocked list does not block a case-variant of a DIFFERENT allowed value", () => {
    const e = makeEngine({ s: { type: "string", allowedValues: ["Good"], caseSensitive: false } });
    // "GOOD" should pass because it matches "Good" case-insensitively
    expectPass(e.evaluate({ s: "GOOD" }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Number — rule-evaluation order
// ─────────────────────────────────────────────────────────────────────────────
describe("Number rule-evaluation order", () => {
  test("nullable checked before min", () => {
    const eng = makeEngine({ n: { type: "number", nullable: false, min: 1 } });
    expectFail(eng.evaluate({ n: null }), "n", "nullable");
  });

  test("min checked before max (a value below min is reported as min, not max)", () => {
    // If min were checked after max, a value below min but within a hypothetical inverted range
    // would be misreported. Provide a value that is below min to confirm min fires.
    const eng = makeEngine({ n: { type: "number", min: 5, max: 10 } });
    expectFail(eng.evaluate({ n: 2 }), "n", "min");
  });

  test("max checked before allowedValues", () => {
    // 20 exceeds max:10 and is not in allowedValues; max should fire first
    const eng = makeEngine({ n: { type: "number", max: 10, allowedValues: [5] } });
    expectFail(eng.evaluate({ n: 20 }), "n", "max");
  });

  test("allowedValues checked before blockedValues is unreachable (schema rejects combination)", () => {
    expect(() =>
      makeEngine({ n: { type: "number", allowedValues: [1], blockedValues: [2] } }),
    ).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Number — Object.is identity for allowedValues / blockedValues
// ─────────────────────────────────────────────────────────────────────────────
describe("Number — Object.is semantics in value lists", () => {
  test("0 is found in allowedValues that contains 0", () => {
    const eng = makeEngine({ n: { type: "number", allowedValues: [0, 1, 2] } });
    expectPass(eng.evaluate({ n: 0 }));
  });

  test("1.5 is found exactly in allowedValues, 1.50001 is not", () => {
    const eng = makeEngine({ n: { type: "number", allowedValues: [1.5] } });
    expectPass(eng.evaluate({ n: 1.5 }));
    expectFail(eng.evaluate({ n: 1.50001 }), "n", "allowedValues");
  });

  test("negative zero -0 is treated as equal to 0 by allowedValues (Object.is(-0,0) is false, but JS includes uses ===)", () => {
    // JS Array.prototype.includes uses SameValueZero, where -0 === 0.
    // So -0 should pass when 0 is in allowedValues.
    const eng = makeEngine({ n: { type: "number", allowedValues: [0] } });
    expectPass(eng.evaluate({ n: -0 }));
  });

  test("blocked value is detected with exact numeric identity", () => {
    const eng = makeEngine({ n: { type: "number", blockedValues: [42] } });
    expectFail(eng.evaluate({ n: 42 }), "n", "blockedValues");
    expectPass(eng.evaluate({ n: 42.0001 }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Date — rule-evaluation order
// ─────────────────────────────────────────────────────────────────────────────
describe("Date rule-evaluation order", () => {
  test("nullable checked before after", () => {
    const eng = makeEngine({ d: { type: "date", nullable: false, after: "2020-01-01" } });
    expectFail(eng.evaluate({ d: null }, OPT), "d", "nullable");
  });

  test("after checked before before", () => {
    // A date that fails "after" (it's before the lower bound) — "before" is set to something
    // even further in the past, so "before" would pass; but "after" should be reported.
    const eng = makeEngine({ d: { type: "date", after: "2023-01-01", before: "2025-01-01" } });
    expectFail(eng.evaluate({ d: new Date("2022-01-01") }, OPT), "d", "after");
  });

  test("before checked before maxAgeDays", () => {
    // A date that is in the future (fails 'before') and also well within maxAgeDays.
    // 'before' boundary is NOW; value is 1 day in the future.
    // maxAgeDays is large enough not to fire. before should be reported.
    const beforeBoundary = NOW.toISOString().slice(0, 10);
    const eng = makeEngine({ d: { type: "date", before: beforeBoundary, maxAgeDays: 9999 } });
    expectFail(eng.evaluate({ d: daysFromNow(1) }, OPT), "d", "before");
  });

  test("maxAgeDays checked before mustBeFuture", () => {
    // A very old past date: fails maxAgeDays. mustBeFuture would also fail (it's in the past)
    // but maxAgeDays is checked first.
    const eng = makeEngine({ d: { type: "date", maxAgeDays: 1, mustBeFuture: true } });
    expectFail(eng.evaluate({ d: daysFromNow(-100) }, OPT), "d", "maxAgeDays");
  });

  test("mustBeFuture checked before mustBePast is impossible (schema rejects both:true)", () => {
    expect(() =>
      makeEngine({ d: { type: "date", mustBeFuture: true, mustBePast: true } }),
    ).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Date — Invalid Date object throws type mismatch
// ─────────────────────────────────────────────────────────────────────────────
describe("Date — Invalid Date object", () => {
  const eng = makeEngine({ d: { type: "date" } });

  test("new Date('not-a-date') throws type mismatch", () => {
    expect(() => eng.evaluate({ d: new Date("not-a-date") }, OPT)).toThrow(/type mismatch/);
  });

  test("new Date(NaN) throws type mismatch", () => {
    expect(() => eng.evaluate({ d: new Date(NaN) }, OPT)).toThrow(/type mismatch/);
  });

  test("a valid Date object with a time component passes", () => {
    expectPass(eng.evaluate({ d: new Date("2020-06-15T08:30:00Z") }, OPT));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Multi-field schema — warnings survive into a failure result
// ─────────────────────────────────────────────────────────────────────────────
describe("Multi-field schema — warnings present in failure result", () => {
  test("unknown-field warning appears on a record that also fails a rule", () => {
    const eng = makeEngine(
      { score: { type: "number", nullable: false, min: 0 } },
      {},
    );
    const engineWithWarnings = new FilterEngine({
      schema: loadSchema({ fields: { score: { type: "number", nullable: false, min: 0 } } }),
      warnUnknownFields: true,
    });

    // record has an unknown field AND a failing score
    const r = engineWithWarnings.evaluate({ score: -1, mystery: "x" }) as any;
    expect(r.ok).toBe(false);
    expect(r.error.rule).toBe("min");
    expect(r.warnings.some((w: any) => w.rule === "unknownField" && w.field === "mystery")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Multi-field schema — second field failure when first passes
// ─────────────────────────────────────────────────────────────────────────────
describe("Multi-field schema — failure on second or later field", () => {
  const eng = makeEngine({
    first: { type: "string", nullable: false },
    second: { type: "number", nullable: false, min: 1 },
    third: { type: "boolean", nullable: false },
  });

  test("second field fails when first passes", () => {
    // first is ok, second fails min
    expectFail(eng.evaluate({ first: "ok", second: 0, third: true }), "second", "min");
  });

  test("third field fails when first two pass", () => {
    expectFail(eng.evaluate({ first: "ok", second: 5, third: null }), "third", "nullable");
  });

  test("all fields passing returns ok:true", () => {
    expectPass(eng.evaluate({ first: "ok", second: 5, third: true }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. evaluateBatch — happy path and mixed results
// ─────────────────────────────────────────────────────────────────────────────
describe("evaluateBatch — happy path and mixed results", () => {
  const eng = makeEngine({ n: { type: "number", nullable: false, min: 0 } });

  test("all-passing batch returns array of ok:true results", () => {
    const results = eng.evaluateBatch([{ n: 0 }, { n: 1 }, { n: 100 }]);
    expect(results).toHaveLength(3);
    results.forEach((r) => expect(r.ok).toBe(true));
  });

  test("mixed batch preserves per-record pass/fail in order", () => {
    const results = eng.evaluateBatch([{ n: 5 }, { n: -1 }, { n: 10 }, { n: null }]) as any[];
    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(false);
    expect(results[1].error.rule).toBe("min");
    expect(results[2].ok).toBe(true);
    expect(results[3].ok).toBe(false);
    expect(results[3].error.rule).toBe("nullable");
  });

  test("batch of one record works correctly", () => {
    const results = eng.evaluateBatch([{ n: 7 }]);
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
  });

  test("each result in the batch has a warnings array", () => {
    const results = eng.evaluateBatch([{ n: 1 }, { n: -1 }]);
    results.forEach((r) => expect(Array.isArray(r.warnings)).toBe(true));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. evaluateBatch — warnings per record
// ─────────────────────────────────────────────────────────────────────────────
describe("evaluateBatch — unknown-field warnings per record", () => {
  const eng = new FilterEngine({
    schema: loadSchema({ fields: { x: { type: "string" } } }),
    warnUnknownFields: true,
  });

  test("each record with an unknown field carries its own warning", () => {
    const results = eng.evaluateBatch([
      { x: "a", extra1: 1 },
      { x: "b" },
      { x: "c", extra2: 2, extra3: 3 },
    ]) as any[];

    expect(results[0].warnings.filter((w: any) => w.rule === "unknownField")).toHaveLength(1);
    expect(results[1].warnings.filter((w: any) => w.rule === "unknownField")).toHaveLength(0);
    expect(results[2].warnings.filter((w: any) => w.rule === "unknownField")).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. warnUnknownFields — warning payload shape
// ─────────────────────────────────────────────────────────────────────────────
describe("warnUnknownFields — warning payload shape", () => {
  const eng = new FilterEngine({
    schema: loadSchema({ fields: { name: { type: "string" } } }),
    warnUnknownFields: true,
  });

  test("warning has kind:'record', rule:'unknownField', field name, and value", () => {
    const r = eng.evaluate({ name: "Alice", colour: "blue" }) as any;
    const w = r.warnings.find((x: any) => x.rule === "unknownField");
    expect(w).toBeDefined();
    expect(w.kind).toBe("record");
    expect(w.field).toBe("colour");
    expect(w.value).toBe("blue");
    expect(typeof w.message).toBe("string");
    expect(w.message.length).toBeGreaterThan(0);
  });

  test("two unknown fields produce two separate warnings with correct field names", () => {
    const r = eng.evaluate({ name: "Bob", a: 1, b: 2 }) as any;
    const unknowns = r.warnings.filter((w: any) => w.rule === "unknownField");
    const fields = unknowns.map((w: any) => w.field).sort();
    expect(fields).toEqual(["a", "b"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. onWarning — callback receives warnings before result is returned
// ─────────────────────────────────────────────────────────────────────────────
describe("onWarning callback — timing and payload", () => {
  test("engine-level onWarning is called once per warning before evaluate returns", () => {
    const calls: unknown[] = [];
    const eng = new FilterEngine({
      schema: loadSchema({ fields: { x: { type: "string" } } }),
      onWarning: (w) => calls.push(w),
      warnUnknownFields: true,
    });

    const r = eng.evaluate({ x: "ok", a: 1, b: 2 });
    // evaluate has returned — calls should already be populated
    expect(calls).toHaveLength(2);
    expect(r.warnings).toHaveLength(2);
  });

  test("per-call onWarning is called and receives the warning object", () => {
    const received: unknown[] = [];
    const eng = new FilterEngine({
      schema: loadSchema({ fields: { x: { type: "string" } } }),
      warnUnknownFields: true,
    });

    eng.evaluate({ x: "ok", extra: 99 }, { onWarning: (w) => received.push(w) });
    expect(received).toHaveLength(1);
    expect((received[0] as any).field).toBe("extra");
  });

  test("no onWarning set and no warnings — evaluate does not throw", () => {
    const eng = new FilterEngine({
      schema: loadSchema({ fields: { x: { type: "string" } } }),
    });
    expect(() => eng.evaluate({ x: "ok" })).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. Exemptions — bypass advanced filters
// ─────────────────────────────────────────────────────────────────────────────
describe("Exemptions — bypass advanced filters", () => {
  test("an exempt record is not passed through a registered advanced filter", () => {
    let ran = false;
    const registry = new FilterRegistry();
    registry.register(() => { ran = true; return { ok: false, error: { field: "x", rule: "customFail", message: "nope" } }; });

    const schema = loadSchema({
      fields: { x: { type: "string" } },
      advancedFilter: true,
      exemptions: [{ field: "role", values: ["admin"] }],
    });
    const eng = new FilterEngine({ schema, filterRegistry: registry });

    const r = eng.evaluate({ role: "admin" });
    expect(r.ok).toBe(true);
    expect((r as any).reason).toBe("exempted");
    expect(ran).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. Exemptions — null as an exempt value
// ─────────────────────────────────────────────────────────────────────────────
describe("Exemptions — null as an exempt value", () => {
  test("null exempt value matches null field value", () => {
    const eng = makeEngine(
      { score: { type: "number", nullable: false } },
      { exemptions: [{ field: "role", values: [null] }] },
    );
    expectExempted(eng.evaluate({ role: null }));
  });

  test("undefined does NOT match null exempt value (Object.is semantics)", () => {
    const eng = makeEngine(
      { score: { type: "number", nullable: false } },
      { exemptions: [{ field: "role", values: [null] }] },
    );
    // role:undefined — exemption field is present with value undefined, which is not null
    expectMissingField(() => eng.evaluate({ role: undefined }), "score");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. Exemptions — multiple exemption rules
// ─────────────────────────────────────────────────────────────────────────────
describe("Exemptions — multiple exemption rules", () => {
  const eng = makeEngine(
    { value: { type: "number", nullable: false, min: 1 } },
    {
      exemptions: [
        { field: "tier", values: ["free"] },
        { field: "status", values: ["archived"] },
      ],
    },
  );

  test("first exemption rule matches", () => expectExempted(eng.evaluate({ tier: "free" })));
  test("second exemption rule matches", () => expectExempted(eng.evaluate({ status: "archived" })));
  test("neither rule matches — field rules apply", () => {
    expectFail(eng.evaluate({ tier: "paid", status: "active", value: 0 }), "value", "min");
  });
  test("both fields present but only first matches — still exempted", () => {
    expectExempted(eng.evaluate({ tier: "free", status: "active" }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 18. Exemptions — exempt record always has empty warnings array
// ─────────────────────────────────────────────────────────────────────────────
describe("Exemptions — warnings array on exempt records", () => {
  test("exempt record has empty warnings even when warnUnknownFields is enabled", () => {
    const eng = new FilterEngine({
      schema: loadSchema({
        fields: { name: { type: "string", nullable: false } },
        exemptions: [{ field: "role", values: ["admin"] }],
      }),
      warnUnknownFields: true,
    });

    const r = eng.evaluate({ role: "admin", unknownExtra: true }) as any;
    expectExempted(r);
    expect(r.warnings).toEqual([]);
  });

  test("onWarning is NOT called for an exempt record", () => {
    const cb = vi.fn();
    const eng = new FilterEngine({
      schema: loadSchema({
        fields: { name: { type: "string", nullable: false } },
        exemptions: [{ field: "role", values: ["admin"] }],
      }),
      warnUnknownFields: true,
      onWarning: cb,
    });

    eng.evaluate({ role: "admin", extra: 1 });
    expect(cb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 19. Schema validation — duplicate values in allowedValues / blockedValues
// ─────────────────────────────────────────────────────────────────────────────
describe("Schema validation — duplicate entries in value lists", () => {
  test("string allowedValues with duplicate entries throws", () => {
    expect(() =>
      makeEngine({ s: { type: "string", allowedValues: ["a", "b", "a"] } }),
    ).toThrow(/duplicate/i);
  });

  test("string blockedValues with duplicate entries throws", () => {
    expect(() =>
      makeEngine({ s: { type: "string", blockedValues: ["x", "x"] } }),
    ).toThrow(/duplicate/i);
  });

  test("number allowedValues with duplicate entries throws", () => {
    expect(() =>
      makeEngine({ n: { type: "number", allowedValues: [1, 2, 1] } }),
    ).toThrow(/duplicate/i);
  });

  test("number blockedValues with duplicate entries throws", () => {
    expect(() =>
      makeEngine({ n: { type: "number", blockedValues: [0, 0] } }),
    ).toThrow(/duplicate/i);
  });

  test("string allowedValues with case-insensitive duplicates throws when caseSensitive:false", () => {
    // "Active" and "active" are duplicates under caseSensitive:false normalization
    expect(() =>
      makeEngine({ s: { type: "string", allowedValues: ["active", "Active"], caseSensitive: false } }),
    ).toThrow(/duplicate/i);
  });

  test("string blockedValues with case-insensitive duplicates throws when caseSensitive:false", () => {
    expect(() =>
      makeEngine({ s: { type: "string", blockedValues: ["spam", "SPAM"], caseSensitive: false } }),
    ).toThrow(/duplicate/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 20. Schema validation — nullable:true is rejected
// ─────────────────────────────────────────────────────────────────────────────
describe("Schema validation — nullable:true is rejected", () => {
  test("string field with nullable:true throws", () => {
    expect(() => makeEngine({ s: { type: "string", nullable: true } })).toThrow();
  });

  test("number field with nullable:true throws", () => {
    expect(() => makeEngine({ n: { type: "number", nullable: true } })).toThrow();
  });

  test("boolean field with nullable:true throws", () => {
    expect(() => makeEngine({ b: { type: "boolean", nullable: true } })).toThrow();
  });

  test("date field with nullable:true throws", () => {
    expect(() => makeEngine({ d: { type: "date", nullable: true } })).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 21. Schema validation — advancedFilter must be boolean
// ─────────────────────────────────────────────────────────────────────────────
describe("Schema validation — advancedFilter type enforcement", () => {
  test("advancedFilter:1 (number) throws", () => {
    expect(() => loadSchemaFromObject({ tamiz: { advancedFilter: 1, fields: {} } } as any)).toThrow();
  });

  test("advancedFilter:'true' (string) throws", () => {
    expect(() => loadSchemaFromObject({ tamiz: { advancedFilter: "true", fields: {} } } as any)).toThrow();
  });

  test("advancedFilter:false is accepted and results in schema.advancedFilter === false", () => {
    const schema = loadSchemaFromObject({ tamiz: { advancedFilter: false, fields: {} } } as any);
    expect(schema.advancedFilter).toBe(false);
  });

  test("advancedFilter:true is accepted and results in schema.advancedFilter === true", () => {
    const schema = loadSchemaFromObject({ tamiz: { advancedFilter: true, fields: {} } } as any);
    expect(schema.advancedFilter).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 22. Schema validation — exemptions array validation
// ─────────────────────────────────────────────────────────────────────────────
describe("Schema validation — exemptions array validation", () => {
  test("exemptions:string (not array) throws", () => {
    expect(() =>
      loadSchema({ fields: {}, exemptions: "admin" }),
    ).toThrow();
  });

  test("exemption entry with empty string field throws", () => {
    expect(() =>
      loadSchema({ fields: {}, exemptions: [{ field: "", values: ["x"] }] }),
    ).toThrow();
  });

  test("exemption entry with empty values array throws", () => {
    expect(() =>
      loadSchema({ fields: {}, exemptions: [{ field: "role", values: [] }] }),
    ).toThrow();
  });

  test("exemption entry with object in values array throws", () => {
    expect(() =>
      loadSchema({ fields: {}, exemptions: [{ field: "role", values: [{}] }] }),
    ).toThrow();
  });

  test("exemption entry with array in values array throws", () => {
    expect(() =>
      loadSchema({ fields: {}, exemptions: [{ field: "role", values: [[]] }] }),
    ).toThrow();
  });

  test("exemption entry that is not an object throws", () => {
    expect(() =>
      loadSchema({ fields: {}, exemptions: ["admin"] }),
    ).toThrow();
  });

  test("valid exemption with all scalar types (string, number, boolean, null) is accepted", () => {
    expect(() =>
      loadSchema({
        fields: { x: { type: "string" } },
        exemptions: [{ field: "tier", values: ["free", 0, true, null] }],
      }),
    ).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 23. Schema validation — loadSchemaFromFile error handling
// ─────────────────────────────────────────────────────────────────────────────
describe("Schema validation — loadSchemaFromFile", () => {
  test("throws when file does not exist", () => {
    expect(() =>
      loadSchemaFromFile(path.resolve("/tmp/tamiz/fixtures/does-not-exist.yml")),
    ).toThrow(/Could not read schema file/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 24. Schema validation — number allowedValues out-of-range with only one bound
// ─────────────────────────────────────────────────────────────────────────────
describe("Schema validation — number allowedValues range checks with partial bounds", () => {
  test("allowedValues entry below min throws even without max", () => {
    expect(() =>
      makeEngine({ n: { type: "number", min: 5, allowedValues: [3, 7] } }),
    ).toThrow();
  });

  test("allowedValues entry above max throws even without min", () => {
    expect(() =>
      makeEngine({ n: { type: "number", max: 10, allowedValues: [5, 15] } }),
    ).toThrow();
  });

  test("allowedValues all within single-sided range is accepted", () => {
    expect(() =>
      makeEngine({ n: { type: "number", min: 1, allowedValues: [1, 5, 100] } }),
    ).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 25. FilterRegistry — snapshot is frozen
// ─────────────────────────────────────────────────────────────────────────────
describe("FilterRegistry — snapshot immutability", () => {
  test("getAll() returns a frozen array", () => {
    const r = new FilterRegistry();
    r.register(() => ({ ok: true }));
    const snap = r.getAll();
    expect(Object.isFrozen(snap)).toBe(true);
  });

  test("mutating the returned snapshot array does not affect the registry", () => {
    const r = new FilterRegistry();
    const f = () => ({ ok: true } as const);
    r.register(f);
    const snap = r.getAll() as any[];
    // attempt to push (should throw in strict mode or silently fail)
    try { snap.push(f); } catch (_) { /* expected */ }
    expect(r.size).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 26. Advanced filters — empty registry skips advanced stage
// ─────────────────────────────────────────────────────────────────────────────
describe("Advanced filters — empty registry with advancedFilter:true", () => {
  test("no filters registered — evaluate passes without touching advanced stage", () => {
    const registry = new FilterRegistry(); // empty
    const schema = loadSchema({ fields: { x: { type: "string" } }, advancedFilter: true });
    const eng = new FilterEngine({ schema, filterRegistry: registry });
    expectPass(eng.evaluate({ x: "ok" }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 27. Advanced filters — filter receives original record unchanged
// ─────────────────────────────────────────────────────────────────────────────
describe("Advanced filters — filter receives the original record", () => {
  test("record passed to filter is the same reference the caller provided", () => {
    let received: unknown = undefined;
    const registry = new FilterRegistry();
    registry.register((record) => { received = record; return { ok: true }; });

    const schema = loadSchema({ fields: { x: { type: "string" } }, advancedFilter: true });
    const eng = new FilterEngine({ schema, filterRegistry: registry });
    const original = { x: "hello" };
    eng.evaluate(original);

    expect(received).toBe(original);
  });

  test("all fields including unknown ones are visible to the filter", () => {
    let seen: Record<string, unknown> | undefined;
    const registry = new FilterRegistry();
    registry.register((record) => { seen = record; return { ok: true }; });

    const schema = loadSchema({ fields: { x: { type: "string" } }, advancedFilter: true });
    const eng = new FilterEngine({ schema, filterRegistry: registry });
    eng.evaluate({ x: "ok", extra: 42 });

    expect(seen?.extra).toBe(42);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 28. Advanced filters — AdvancedFilterError for anonymous filter has no filterName
// ─────────────────────────────────────────────────────────────────────────────
describe("Advanced filters — AdvancedFilterError for anonymous vs named filters", () => {
  test("anonymous arrow function produces AdvancedFilterError with undefined filterName", () => {
    const registry = new FilterRegistry();
    // arrow functions have empty .name in most runtimes
    registry.register(() => { throw new Error("boom"); });
    const schema = loadSchema({ fields: { x: { type: "string" } }, advancedFilter: true });
    const eng = new FilterEngine({ schema, filterRegistry: registry });

    try {
      eng.evaluate({ x: "val" });
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AdvancedFilterError);
      const e = err as AdvancedFilterError;
      expect(e.filterIndex).toBe(0);
      // arrow functions have empty string name; the engine maps "" to undefined
      expect(e.filterName === undefined || e.filterName === "").toBe(true);
    }
  });

  test("named function expression produces AdvancedFilterError with correct filterName", () => {
    const registry = new FilterRegistry();
    registry.register(function myCustomFilter() { throw new Error("crash"); });
    const schema = loadSchema({ fields: { x: { type: "string" } }, advancedFilter: true });
    const eng = new FilterEngine({ schema, filterRegistry: registry });

    try {
      eng.evaluate({ x: "val" });
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AdvancedFilterError);
      const e = err as AdvancedFilterError;
      expect(e.filterIndex).toBe(0);
      expect(e.filterName).toBe("myCustomFilter");
    }
  });

  test("AdvancedFilterError.cause is the original error", () => {
    const original = new Error("root cause");
    const registry = new FilterRegistry();
    registry.register(() => { throw original; });
    const schema = loadSchema({ fields: { x: { type: "string" } }, advancedFilter: true });
    const eng = new FilterEngine({ schema, filterRegistry: registry });

    try {
      eng.evaluate({ x: "val" });
    } catch (err) {
      expect((err as any).cause).toBe(original);
    }
  });

  test("filterIndex reflects position in registry when second filter crashes", () => {
    const registry = new FilterRegistry();
    registry.register(() => ({ ok: true }));
    registry.register(function crasher() { throw new Error("second crash"); });
    const schema = loadSchema({ fields: { x: { type: "string" } }, advancedFilter: true });
    const eng = new FilterEngine({ schema, filterRegistry: registry });

    try {
      eng.evaluate({ x: "val" });
    } catch (err) {
      expect(err).toBeInstanceOf(AdvancedFilterError);
      expect((err as AdvancedFilterError).filterIndex).toBe(1);
      expect((err as AdvancedFilterError).filterName).toBe("crasher");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 29. Boolean — no existing test for mustBe omitted (any boolean passes)
// ─────────────────────────────────────────────────────────────────────────────
describe("Boolean — mustBe omitted allows any boolean", () => {
  const eng = makeEngine({ flag: { type: "boolean", nullable: false } });

  test("true passes when mustBe is not set", () => expectPass(eng.evaluate({ flag: true })));
  test("false passes when mustBe is not set", () => expectPass(eng.evaluate({ flag: false })));
});

// ─────────────────────────────────────────────────────────────────────────────
// 30. Date — maxAgeDays with exactly zero age (value === now)
// ─────────────────────────────────────────────────────────────────────────────
describe("Date — maxAgeDays boundary when value equals now", () => {
  test("value equal to NOW passes maxAgeDays:0 — but schema rejects maxAgeDays:0 (min:1)", () => {
    // The schema enforces maxAgeDays >= 1, so 0 is an invalid config value
    expect(() => makeEngine({ d: { type: "date", maxAgeDays: 0 } })).toThrow();
  });

  test("value equal to NOW passes maxAgeDays:1 (age is 0, within 1 day)", () => {
    const eng = makeEngine({ d: { type: "date", maxAgeDays: 1 } });
    expectPass(eng.evaluate({ d: NOW }, OPT));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 31. String — minLength:1 with maxLength:1 (single character constraint)
// ─────────────────────────────────────────────────────────────────────────────
describe("String — minLength equals maxLength (exact length required)", () => {
  const eng = makeEngine({ code: { type: "string", nullable: false, minLength: 3, maxLength: 3 } });

  test("exactly 3 chars passes", () => expectPass(eng.evaluate({ code: "abc" })));
  test("2 chars fails minLength", () => expectFail(eng.evaluate({ code: "ab" }), "code", "minLength"));
  test("4 chars fails maxLength", () => expectFail(eng.evaluate({ code: "abcd" }), "code", "maxLength"));
});

// ─────────────────────────────────────────────────────────────────────────────
// 32. Number — min equals max (single allowed numeric value via range)
// ─────────────────────────────────────────────────────────────────────────────
describe("Number — min equals max (single numeric value allowed by range)", () => {
  const eng = makeEngine({ n: { type: "number", min: 5, max: 5 } });

  test("exactly 5 passes", () => expectPass(eng.evaluate({ n: 5 })));
  test("4 fails min", () => expectFail(eng.evaluate({ n: 4 }), "n", "min"));
  test("6 fails max", () => expectFail(eng.evaluate({ n: 6 }), "n", "max"));
});

// ─────────────────────────────────────────────────────────────────────────────
// 33. Schema — tamiz wrapper must be an object (not a scalar)
// ─────────────────────────────────────────────────────────────────────────────
describe("Schema validation — tamiz wrapper type enforcement", () => {
  test("tamiz:null throws", () => {
    expect(() => loadSchemaFromObject({ tamiz: null } as any)).toThrow();
  });

  test("tamiz:array throws", () => {
    expect(() => loadSchemaFromObject({ tamiz: [] } as any)).toThrow();
  });

  test("tamiz:string throws", () => {
    expect(() => loadSchemaFromObject({ tamiz: "schema" } as any)).toThrow();
  });

  test("loadSchemaFromObject with non-object root throws", () => {
    expect(() => loadSchemaFromObject("not-an-object" as any)).toThrow();
  });
});

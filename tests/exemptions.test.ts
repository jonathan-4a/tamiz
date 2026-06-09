import { describe, test, expect, vi } from "vitest";
import { makeEngine, expectPass, expectFail, expectExempted, expectMissingField, NOW } from "./helpers.js";

const OPT = { now: NOW };

describe("Exemptions", () => {
  describe("basic exemption", () => {
    const eng = makeEngine(
      { name: { type: "string", nullable: false, minLength: 3 } },
      { exemptions: [{ field: "role", values: ["admin"] }] },
    );

    test("exempted record returns ok:true with reason 'exempted'", () => {
      expectExempted(eng.evaluate({ role: "admin" }, OPT));
    });

    test("exemption bypasses field validation", () => {
      // no 'name' field, would normally throw — exempt skips all rules
      expect(eng.evaluate({ role: "admin" }, OPT).ok).toBe(true);
    });

    test("exemption bypasses field-rule warnings", () => {
      const onWarning = vi.fn();
      const result = eng.evaluate(
        { role: "admin", extra: true },
        { ...OPT, warnUnknownFields: true, onWarning },
      );

      expectExempted(result);
      expect(result.warnings).toEqual([]);
      expect(onWarning).not.toHaveBeenCalled();
    });

    test("non-matching value is not exempted and missing field throws", () => {
      expectMissingField(() => eng.evaluate({ role: "user" }, OPT), "name");
    });

    test("passing (non-exempt) record has reason 'passed'", () => {
      const r = eng.evaluate({ role: "user", name: "Alice" }, OPT) as any;
      expect(r.ok).toBe(true);
      expect(r.reason).toBe("passed");
    });
  });

  describe("multiple exempt values", () => {
    const eng = makeEngine(
      { score: { type: "number", nullable: false } },
      { exemptions: [{ field: "role", values: ["admin", "superuser"] }] },
    );

    test("first exempt value triggers exemption", () => expectExempted(eng.evaluate({ role: "admin" }, OPT)));
    test("second exempt value triggers exemption", () => expectExempted(eng.evaluate({ role: "superuser" }, OPT)));
    test("non-exempt value with missing field throws", () => {
      expectMissingField(() => eng.evaluate({ role: "editor" }, OPT), "score");
    });
  });

  describe("non-string exempt values", () => {
    test("numeric exempt value 0 triggers exemption", () => {
      const eng = makeEngine(
        { name: { type: "string", nullable: false } },
        { exemptions: [{ field: "tier", values: [0, 99] }] },
      );
      expectExempted(eng.evaluate({ tier: 0 }, OPT));
      expectExempted(eng.evaluate({ tier: 99 }, OPT));
      expectMissingField(() => eng.evaluate({ tier: 5 }, OPT), "name");
    });

    test("boolean exempt value triggers exemption", () => {
      const eng = makeEngine(
        { name: { type: "string", nullable: false } },
        { exemptions: [{ field: "isSpecial", values: [true] }] },
      );
      expectExempted(eng.evaluate({ isSpecial: true }, OPT));
      // false doesn't match
      expectMissingField(() => eng.evaluate({ isSpecial: false }, OPT), "name");
    });
  });

  describe("exemption field absent from record", () => {
    test("record without the exemption field is not exempted", () => {
      const eng = makeEngine(
        { name: { type: "string", nullable: false } },
        { exemptions: [{ field: "role", values: ["admin"] }] },
      );
      expectMissingField(() => eng.evaluate({}), "name");
    });
  });
});

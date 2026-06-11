import { describe, test, expect } from "vitest";
import { makeEngine, expectExempted, expectMissingField, NOW } from "./helpers.js";

const OPT = { now: NOW };

describe("Exemptions", () => {
  describe("basic exemption", () => {
    const eng = makeEngine(
      { name: { type: "string", nullable: false, minLength: 3 } },
      { exemptions: [{ field: "role", values: ["admin"] }] },
    );

    test("exempted record returns ok:true with reason 'exempted'", async () => {
      await expectExempted(eng.evaluate({ role: "admin" }, OPT));
    });

    test("exemption bypasses field validation", async () => {
      // no 'name' field, would normally throw — exempt skips all rules
      const r = await eng.evaluate({ role: "admin" }, OPT);
      expect(r.ok).toBe(true);
    });

    test("exemption bypasses field-rule warnings and emits info event", async () => {
      const events: unknown[] = [];
      const result = eng.evaluate(
        { role: "admin", extra: true },
        { ...OPT, onEvent: (e) => events.push(e) },
      );

      await expectExempted(result);
      // only an info event for exemption, no warning events
      expect((events as any[]).every((e: any) => e.kind === "info")).toBe(true);
    });

    test("non-matching value is not exempted and missing field throws", async () => {
      await expectMissingField(() => eng.evaluate({ role: "user" }, OPT), "name");
    });

    test("passing (non-exempt) record has reason 'passed'", async () => {
      const r = await eng.evaluate({ role: "user", name: "Alice" }, OPT);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.reason).toBe("passed");
    });
  });

  describe("multiple exempt values", () => {
    const eng = makeEngine(
      { score: { type: "number", nullable: false } },
      { exemptions: [{ field: "role", values: ["admin", "superuser"] }] },
    );

    test("first exempt value triggers exemption", () => expectExempted(eng.evaluate({ role: "admin" }, OPT)));
    test("second exempt value triggers exemption", () => expectExempted(eng.evaluate({ role: "superuser" }, OPT)));
    test("non-exempt value with missing field throws", async () => {
      await expectMissingField(() => eng.evaluate({ role: "editor" }, OPT), "score");
    });
  });

  describe("non-string exempt values", () => {
    test("numeric exempt value 0 triggers exemption", async () => {
      const eng = makeEngine(
        { name: { type: "string", nullable: false } },
        { exemptions: [{ field: "tier", values: [0, 99] }] },
      );
      await expectExempted(eng.evaluate({ tier: 0 }, OPT));
      await expectExempted(eng.evaluate({ tier: 99 }, OPT));
      await expectMissingField(() => eng.evaluate({ tier: 5 }, OPT), "name");
    });

    test("boolean exempt value triggers exemption", async () => {
      const eng = makeEngine(
        { name: { type: "string", nullable: false } },
        { exemptions: [{ field: "isSpecial", values: [true] }] },
      );
      await expectExempted(eng.evaluate({ isSpecial: true }, OPT));
      await expectMissingField(() => eng.evaluate({ isSpecial: false }, OPT), "name");
    });
  });

  describe("exemption field absent from record", () => {
    test("record without the exemption field is not exempted", async () => {
      const eng = makeEngine(
        { name: { type: "string", nullable: false } },
        { exemptions: [{ field: "role", values: ["admin"] }] },
      );
      await expectMissingField(() => eng.evaluate({}), "name");
    });
  });
});

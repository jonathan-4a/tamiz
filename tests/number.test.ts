import { describe, test, expect } from "vitest";
import { makeEngine, expectPass, expectFail, expectMissingField } from "./helpers.js";

describe("Number fields", () => {
  describe("nullable: false", () => {
    const eng = makeEngine({ n: { type: "number", nullable: false } });

    test("passes positive integer", () => expectPass(eng.evaluate({ n: 25 })));
    test("passes zero", () => expectPass(eng.evaluate({ n: 0 })));
    test("passes negative", () => expectPass(eng.evaluate({ n: -1 })));
    test("fails null", () => expectFail(eng.evaluate({ n: null }), "n", "nullable"));
    test("throws for absent key", () => expectMissingField(() => eng.evaluate({}), "n"));
  });

  describe("nullable omitted", () => {
    const eng = makeEngine({ n: { type: "number" } });

    test("allows empty values", async () => {
      await expectPass(eng.evaluate({ n: null }));
      await expectPass(eng.evaluate({ n: undefined }));
    });
  });

  describe("type mismatch throws", () => {
    const eng = makeEngine({ n: { type: "number", nullable: false } });

    test("string throws", async () => { await expect(eng.evaluate({ n: "1" })).rejects.toThrow(/type mismatch/); });
    test("Infinity throws", async () => { await expect(eng.evaluate({ n: Infinity })).rejects.toThrow(/type mismatch/); });
    test("-Infinity throws", async () => { await expect(eng.evaluate({ n: -Infinity })).rejects.toThrow(/type mismatch/); });
    test("NaN throws", async () => { await expect(eng.evaluate({ n: NaN })).rejects.toThrow(/type mismatch/); });
  });

  describe("min", () => {
    const eng = makeEngine({ n: { type: "number", min: 1 } });

    test("passes at boundary", () => expectPass(eng.evaluate({ n: 1 })));
    test("passes above boundary", () => expectPass(eng.evaluate({ n: 100 })));
    test("fails one below boundary", () => expectFail(eng.evaluate({ n: 0 }), "n", "min"));
    test("fails negative", () => expectFail(eng.evaluate({ n: -1 }), "n", "min"));
  });

  describe("min with negative boundary", () => {
    const eng = makeEngine({ n: { type: "number", min: -10 } });

    test("passes at negative boundary", () => expectPass(eng.evaluate({ n: -10 })));
    test("fails one below negative boundary", () => expectFail(eng.evaluate({ n: -11 }), "n", "min"));
  });

  describe("max", () => {
    const eng = makeEngine({ n: { type: "number", max: 100 } });

    test("passes at boundary", () => expectPass(eng.evaluate({ n: 100 })));
    test("passes below boundary", () => expectPass(eng.evaluate({ n: 50 })));
    test("fails one above boundary", () => expectFail(eng.evaluate({ n: 101 }), "n", "max"));
  });

  describe("min and max combined", () => {
    const eng = makeEngine({ n: { type: "number", min: 1, max: 10 } });

    test("passes at lower boundary", () => expectPass(eng.evaluate({ n: 1 })));
    test("passes at upper boundary", () => expectPass(eng.evaluate({ n: 10 })));
    test("passes in middle", () => expectPass(eng.evaluate({ n: 5 })));
    test("fails below lower", () => expectFail(eng.evaluate({ n: 0 }), "n", "min"));
    test("fails above upper", () => expectFail(eng.evaluate({ n: 11 }), "n", "max"));
  });

  describe("allowedValues", () => {
    const eng = makeEngine({ n: { type: "number", allowedValues: [1, 2, 3] } });

    test("passes each listed value", async () => {
      await expectPass(eng.evaluate({ n: 1 }));
      await expectPass(eng.evaluate({ n: 2 }));
      await expectPass(eng.evaluate({ n: 3 }));
    });
    test("fails unlisted value", () => expectFail(eng.evaluate({ n: 4 }), "n", "allowedValues"));
    test("fails zero when not listed", () => expectFail(eng.evaluate({ n: 0 }), "n", "allowedValues"));
    test("negative numbers work in list", async () => {
      const e = makeEngine({ n: { type: "number", allowedValues: [-1, 0] } });
      await expectPass(e.evaluate({ n: -1 }));
      await expectFail(e.evaluate({ n: 1 }), "n", "allowedValues");
    });
  });

  describe("blockedValues", () => {
    const eng = makeEngine({ n: { type: "number", blockedValues: [0, -1] } });

    test("passes non-blocked value", () => expectPass(eng.evaluate({ n: 5 })));
    test("fails each blocked value", async () => {
      await expectFail(eng.evaluate({ n: 0 }), "n", "blockedValues");
      await expectFail(eng.evaluate({ n: -1 }), "n", "blockedValues");
    });
  });

  describe("floating point", () => {
    const eng = makeEngine({ n: { type: "number", min: 0, max: 9999.99 } });

    test("passes decimal in range", () => expectPass(eng.evaluate({ n: 19.99 })));
    test("fails small negative decimal", () => expectFail(eng.evaluate({ n: -0.01 }), "n", "min"));
    test("fails above max", () => expectFail(eng.evaluate({ n: 10000 }), "n", "max"));
  });
});

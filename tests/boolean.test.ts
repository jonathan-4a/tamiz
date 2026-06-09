import { describe, test, expect } from "vitest";
import { makeEngine, expectPass, expectFail, expectMissingField } from "./helpers.js";

describe("Boolean fields", () => {
  describe("nullable: false", () => {
    const eng = makeEngine({ active: { type: "boolean", nullable: false } });

    // Both true and false are valid; null/undefined fail unless nullable:true.
    test("passes true", () => expectPass(eng.evaluate({ active: true })));
    test("passes false", () => expectPass(eng.evaluate({ active: false })));
    test("fails null", () => expectFail(eng.evaluate({ active: null }), "active", "nullable"));
    test("fails undefined", () => expectFail(eng.evaluate({ active: undefined }), "active", "nullable"));
    test("throws for absent key", () => expectMissingField(() => eng.evaluate({}), "active"));
  });

  describe("nullable omitted", () => {
    const eng = makeEngine({ flag: { type: "boolean" } });

    test("allows empty values", () => {
      expectPass(eng.evaluate({ flag: null }));
      expectPass(eng.evaluate({ flag: undefined }));
    });
  });

  describe("type mismatch throws", () => {
    const eng = makeEngine({ b: { type: "boolean", nullable: false } });

    test("number 1 throws", () => { expect(() => eng.evaluate({ b: 1 })).toThrow(/type mismatch/); });
    test("string 'true' throws", () => { expect(() => eng.evaluate({ b: "true" })).toThrow(/type mismatch/); });
  });

  describe("mustBe: true", () => {
    const eng = makeEngine({ agreed: { type: "boolean", nullable: false, mustBe: true } });

    test("passes true", () => expectPass(eng.evaluate({ agreed: true })));
    test("fails false", () => expectFail(eng.evaluate({ agreed: false }), "agreed", "mustBe"));
  });

  describe("mustBe: false", () => {
    const eng = makeEngine({ flagged: { type: "boolean", nullable: false, mustBe: false } });

    test("passes false", () => expectPass(eng.evaluate({ flagged: false })));
    test("fails true", () => expectFail(eng.evaluate({ flagged: true }), "flagged", "mustBe"));
  });


});

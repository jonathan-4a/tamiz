import { describe, it, expect } from "vitest";
import path from "path";
import { FilterEngine, loadSchemaFromObject, loadSchemaFromFile } from "../src/index.js";
import { expectMissingField } from "./helpers.js";

function loadSchema(tamiz: Record<string, unknown>) {
  return loadSchemaFromObject({ tamiz } as Parameters<typeof loadSchemaFromObject>[0]);
}

describe("Schema loading", () => {
  describe("loadSchemaFromObject", () => {
    it("requires top-level tamiz wrapper", () => {
      expect(() => loadSchemaFromObject({ fields: {} })).toThrow("tamiz");
    });

    it("loads valid schema and engine evaluates correctly", () => {
      const schema = loadSchema({ fields: { name: { type: "string", nullable: false } } });
      const eng = new FilterEngine({ schema });
      expect(eng.evaluate({ name: "Alice" }).ok).toBe(true);
      expectMissingField(() => eng.evaluate({}), "name");
    });

    it("accepts empty fields object", () => {
      const schema = loadSchema({ fields: {} });
      expect(schema.fields).toEqual({});
    });

    it("defaults exemptions to [] and advancedFilter to false", () => {
      const schema = loadSchema({ fields: { x: { type: "string" } } });
      expect(schema.exemptions).toEqual([]);
      expect(schema.advancedFilter).toBe(false);
    });
  });

  describe("loadSchemaFromFile", () => {
    it("rejects flat YAML schema (missing tamiz wrapper)", () => {
      expect(() =>
        loadSchemaFromFile(path.resolve(__dirname, "../fixtures/invalid-flat-schema.yml")),
      ).toThrow("tamiz");
    });

    it("loads tamiz-wrapped YAML and engine evaluates correctly", () => {
      const schema = loadSchemaFromFile(
        path.resolve(__dirname, "../fixtures/wrapped-schema.yml"),
      );
      const eng = new FilterEngine({ schema });
      expect(eng.evaluate({ email: "user@example.com" }).ok).toBe(true);
      expect(eng.evaluate({ email: "" }).ok).toBe(false);
    });
  });

  describe("rejects invalid field declarations", () => {
    it("throws when fields is missing", () => {
      expect(() => loadSchema({})).toThrow();
    });

    it("throws when type is missing", () => {
      expect(() => loadSchema({ fields: { x: {} } })).toThrow();
    });

    it("throws when type is unknown", () => {
      expect(() => loadSchema({ fields: { x: { type: "array" } } })).toThrow();
    });

    it("throws when nullable is not boolean", () => {
      expect(() => loadSchema({ fields: { x: { type: "string", nullable: "yes" } } })).toThrow();
    });

    it("throws when field has unknown key for its type", () => {
      expect(() => loadSchema({ fields: { x: { type: "string", unknownProp: true } } })).toThrow();
      expect(() => loadSchema({ fields: { x: { type: "number", color: "red" } } })).toThrow();
      expect(() => loadSchema({ fields: { x: { type: "boolean", minLength: 1 } } })).toThrow();
      expect(() => loadSchema({ fields: { x: { type: "date", min: 0 } } })).toThrow();
    });
  });

  describe("rejects invalid string rule options", () => {
    it("throws when minLength is negative or non-integer", () => {
      expect(() => loadSchema({ fields: { x: { type: "string", minLength: -1 } } })).toThrow();
      expect(() => loadSchema({ fields: { x: { type: "string", minLength: 1.5 } } })).toThrow();
    });

    it("throws when minLength exceeds maxLength", () => {
      expect(() => loadSchema({ fields: { x: { type: "string", minLength: 10, maxLength: 5 } } })).toThrow();
    });

    it("throws when allowedValues is empty, non-array, or contains non-strings", () => {
      expect(() => loadSchema({ fields: { x: { type: "string", allowedValues: [] } } })).toThrow();
      expect(() => loadSchema({ fields: { x: { type: "string", allowedValues: "no" } } })).toThrow();
      expect(() => loadSchema({ fields: { x: { type: "string", allowedValues: ["a", 1] } } })).toThrow();
    });

    it("throws when allowedValues entries violate minLength or maxLength", () => {
      expect(() => loadSchema({ fields: { x: { type: "string", minLength: 5, allowedValues: ["ab"] } } })).toThrow();
      expect(() => loadSchema({ fields: { x: { type: "string", maxLength: 2, allowedValues: ["toolong"] } } })).toThrow();
    });

    it("throws when both allowedValues and blockedValues are defined", () => {
      expect(() => loadSchema({
        fields: { x: { type: "string", allowedValues: ["a"], blockedValues: ["b"] } },
      })).toThrow();
    });

    it("throws when caseSensitive is not boolean", () => {
      expect(() => loadSchema({ fields: { x: { type: "string", caseSensitive: 1 } } })).toThrow();
    });
  });

  describe("rejects invalid number rule options", () => {
    it("throws when min or max is not finite", () => {
      expect(() => loadSchema({ fields: { x: { type: "number", min: "zero" } } })).toThrow();
      expect(() => loadSchema({ fields: { x: { type: "number", max: Infinity } } })).toThrow();
    });

    it("throws when min exceeds max", () => {
      expect(() => loadSchema({ fields: { x: { type: "number", min: 10, max: 5 } } })).toThrow();
    });

    it("throws when allowedValues contains non-numbers or out-of-range entries", () => {
      expect(() => loadSchema({ fields: { x: { type: "number", allowedValues: [1, "two"] } } })).toThrow();
      expect(() => loadSchema({ fields: { x: { type: "number", min: 1, max: 5, allowedValues: [0, 10] } } })).toThrow();
    });
  });

  describe("rejects invalid boolean/date rule options", () => {
    it("throws when mustBe is not boolean", () => {
      expect(() => loadSchema({ fields: { x: { type: "boolean", mustBe: "true" } } })).toThrow();
    });

    it("throws when date after/before are invalid strings or logically impossible", () => {
      expect(() => loadSchema({ fields: { x: { type: "date", after: "not-a-date" } } })).toThrow();
      expect(() => loadSchema({ fields: { x: { type: "date", after: "2025-01-01", before: "2024-01-01" } } })).toThrow();
      expect(() => loadSchema({ fields: { x: { type: "date", after: "2024-01-01", before: "2024-01-01" } } })).toThrow();
    });

    it("throws when maxAgeDays is not a positive integer", () => {
      expect(() => loadSchema({ fields: { x: { type: "date", maxAgeDays: 1.5 } } })).toThrow();
    });

    it("throws when mustBeFuture and mustBePast are both true", () => {
      expect(() => loadSchema({ fields: { x: { type: "date", mustBeFuture: true, mustBePast: true } } })).toThrow();
    });
  });
});

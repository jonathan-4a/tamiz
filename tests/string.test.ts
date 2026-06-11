import { describe, test, expect } from "vitest";
import { makeEngine, expectPass, expectFail, expectMissingField } from "./helpers.js";

describe("String fields", () => {
  describe("nullable: false", () => {
    const eng = makeEngine({ name: { type: "string", nullable: false } });

    test("passes non-empty string", () => expectPass(eng.evaluate({ name: "Alice" })));
    test("fails null", () => expectFail(eng.evaluate({ name: null }), "name", "nullable"));
    test("fails undefined", () => expectFail(eng.evaluate({ name: undefined }), "name", "nullable"));
    test("fails empty string", () => expectFail(eng.evaluate({ name: "" }), "name", "nullable"));
    test("throws for absent key", () => expectMissingField(() => eng.evaluate({}), "name"));
  });

  describe("nullable omitted", () => {
    const eng = makeEngine({ name: { type: "string" } });

    test("allows empty values", async () => {
      await expectPass(eng.evaluate({ name: null }));
      await expectPass(eng.evaluate({ name: undefined }));
      await expectPass(eng.evaluate({ name: "" }));
    });
  });

  describe("type mismatch throws", () => {
    const eng = makeEngine({ s: { type: "string", nullable: false } });

    test("number throws", async () => { await expect(eng.evaluate({ s: 42 })).rejects.toThrow(/type mismatch/); });
    test("boolean throws", async () => { await expect(eng.evaluate({ s: true })).rejects.toThrow(/type mismatch/); });
  });

  describe("minLength", () => {
    const eng = makeEngine({ code: { type: "string", minLength: 3 } });

    test("passes at boundary", () => expectPass(eng.evaluate({ code: "abc" })));
    test("passes above boundary", () => expectPass(eng.evaluate({ code: "abcd" })));
    test("fails one below boundary", () => expectFail(eng.evaluate({ code: "ab" }), "code", "minLength"));
  });

  describe("maxLength", () => {
    const eng = makeEngine({ bio: { type: "string", maxLength: 5 } });

    test("passes at boundary", () => expectPass(eng.evaluate({ bio: "hello" })));
    test("passes below boundary", () => expectPass(eng.evaluate({ bio: "hi" })));
    test("fails one above boundary", () => expectFail(eng.evaluate({ bio: "toolong" }), "bio", "maxLength"));
    test("maxLength:0 rejects any non-empty string", async () => {
      const e = makeEngine({ x: { type: "string", maxLength: 0 } });
      await expectFail(e.evaluate({ x: "a" }), "x", "maxLength");
    });
  });

  describe("allowedValues (case-sensitive by default)", () => {
    const eng = makeEngine({ s: { type: "string", allowedValues: ["active", "inactive"] } });

    test("passes listed value", () => expectPass(eng.evaluate({ s: "active" })));
    test("fails unlisted value", () => expectFail(eng.evaluate({ s: "pending" }), "s", "allowedValues"));
    test("fails differing case", () => expectFail(eng.evaluate({ s: "Active" }), "s", "allowedValues"));
  });

  describe("blockedValues (case-sensitive by default)", () => {
    const eng = makeEngine({ role: { type: "string", blockedValues: ["banned"] } });

    test("passes non-blocked value", () => expectPass(eng.evaluate({ role: "user" })));
    test("fails blocked value", () => expectFail(eng.evaluate({ role: "banned" }), "role", "blockedValues"));
    test("passes differing case (strict)", () => expectPass(eng.evaluate({ role: "Banned" })));
  });

  describe("caseSensitive: false", () => {
    const engAllowed = makeEngine({ s: { type: "string", allowedValues: ["active"], caseSensitive: false } });
    const engBlocked = makeEngine({ s: { type: "string", blockedValues: ["spam"], caseSensitive: false } });

    test("allowedValues: passes uppercase variant", () => expectPass(engAllowed.evaluate({ s: "ACTIVE" })));
    test("allowedValues: passes mixed case", () => expectPass(engAllowed.evaluate({ s: "Active" })));
    test("allowedValues: still fails non-matching", () => expectFail(engAllowed.evaluate({ s: "pending" }), "s", "allowedValues"));
    test("blockedValues: fails uppercase variant", () => expectFail(engBlocked.evaluate({ s: "SPAM" }), "s", "blockedValues"));
    test("blockedValues: passes non-blocked", () => expectPass(engBlocked.evaluate({ s: "hello" })));
  });

  describe("unicode length (uses .length / UTF-16 code units)", () => {
    // Implementation uses value.length — emoji are 2 code units, CJK are 1
    const eng = makeEngine({ s: { type: "string", minLength: 1, maxLength: 3 } });

    test("single accented char passes", () => expectPass(eng.evaluate({ s: "ñ" })));
    test("CJK chars count as 1 each", () => expectPass(eng.evaluate({ s: "中文" })));
    test("four CJK chars exceed maxLength:3", () => expectFail(eng.evaluate({ s: "一二三四" }), "s", "maxLength"));
    // emoji "😀" is length 2 in UTF-16
    test("emoji is 2 code units, passes maxLength:3", () => expectPass(eng.evaluate({ s: "😀" })));
  });

  describe("combined rules: rule evaluation order", () => {
    const eng = makeEngine({
      username: {
        type: "string", nullable: false, minLength: 3, maxLength: 20,
        blockedValues: ["admin"], caseSensitive: false,
      },
    });

    test("passes valid username", () => expectPass(eng.evaluate({ username: "alice" })));
    test("missing field checked before minLength", () => expectMissingField(() => eng.evaluate({}), "username"));
    test("minLength checked before blockedValues", () => expectFail(eng.evaluate({ username: "ab" }), "username", "minLength"));
    test("maxLength checked", () => expectFail(eng.evaluate({ username: "a".repeat(21) }), "username", "maxLength"));
    test("blockedValues case-insensitive", () => expectFail(eng.evaluate({ username: "ADMIN" }), "username", "blockedValues"));
  });

  describe("first failing field reported", () => {
    const eng = makeEngine({ a: { type: "string", nullable: false }, b: { type: "string", nullable: false } });

    test("throws for field 'a' when both absent", async () => {
      await expectMissingField(() => eng.evaluate({}), "a");
    });
  });
});

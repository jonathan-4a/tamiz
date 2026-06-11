import { describe, test, expect } from "vitest";
import { makeEngine, expectPass, expectFail, expectMissingField, NOW, daysFromNow } from "./helpers.js";

const OPT = { now: NOW };

describe("Date fields", () => {
  describe("nullable: false", () => {
    const eng = makeEngine({ d: { type: "date", nullable: false } });

    test("passes valid Date", () => expectPass(eng.evaluate({ d: new Date("2000-01-01") }, OPT)));
    test("fails null", () => expectFail(eng.evaluate({ d: null }, OPT), "d", "nullable"));
    test("fails undefined", () => expectFail(eng.evaluate({ d: undefined }, OPT), "d", "nullable"));
    test("throws for absent key", () => expectMissingField(() => eng.evaluate({}, OPT), "d"));
    test("string date throws type mismatch", async () => {
      await expect(eng.evaluate({ d: "2000-01-01" }, OPT)).rejects.toThrow(/type mismatch/);
    });
  });

  describe("nullable omitted", () => {
    const eng = makeEngine({ d: { type: "date" } });

    test("allows empty values", async () => {
      await expectPass(eng.evaluate({ d: null }, OPT));
      await expectPass(eng.evaluate({ d: undefined }, OPT));
    });
  });

  describe("after (strict greater-than)", () => {
    const eng = makeEngine({ d: { type: "date", after: "2020-01-01" } });

    test("passes date strictly after boundary", () => expectPass(eng.evaluate({ d: new Date("2021-01-01") }, OPT)));
    test("fails date equal to boundary", () => expectFail(eng.evaluate({ d: new Date("2020-01-01") }, OPT), "d", "after"));
    test("fails date before boundary", () => expectFail(eng.evaluate({ d: new Date("2019-12-31") }, OPT), "d", "after"));
  });

  describe("before (strict less-than)", () => {
    const eng = makeEngine({ d: { type: "date", before: "2027-01-01" } });

    test("passes date strictly before boundary", () => expectPass(eng.evaluate({ d: new Date("2026-12-31") }, OPT)));
    test("fails date equal to boundary", () => expectFail(eng.evaluate({ d: new Date("2027-01-01") }, OPT), "d", "before"));
    test("fails date after boundary", () => expectFail(eng.evaluate({ d: new Date("2028-01-01") }, OPT), "d", "before"));
  });

  describe("after + before window", () => {
    const eng = makeEngine({ d: { type: "date", after: "2024-01-01", before: "2025-01-01" } });

    test("passes inside window", () => expectPass(eng.evaluate({ d: new Date("2024-06-15") }, OPT)));
    test("fails before window (after rule)", () => expectFail(eng.evaluate({ d: new Date("2023-12-31") }, OPT), "d", "after"));
    test("fails after window (before rule)", () => expectFail(eng.evaluate({ d: new Date("2025-01-02") }, OPT), "d", "before"));
    test("leap year date inside window passes", () => expectPass(eng.evaluate({ d: new Date("2024-02-29") }, OPT)));
  });

  describe("maxAgeDays", () => {
    const eng = makeEngine({ d: { type: "date", maxAgeDays: 30 } });

    test("passes at exactly the boundary (30 days ago, inclusive)", async () => {
      await expectPass(eng.evaluate({ d: daysFromNow(-30) }, OPT));
    });
    test("passes within boundary", () => expectPass(eng.evaluate({ d: daysFromNow(-10) }, OPT)));
    test("fails one day past boundary (31 days ago)", async () => {
      await expectFail(eng.evaluate({ d: daysFromNow(-31) }, OPT), "d", "maxAgeDays");
    });
    test("passes future date (age is negative)", () => expectPass(eng.evaluate({ d: daysFromNow(1) }, OPT)));
  });

  describe("maxAgeDays: 1 — tight boundary", () => {
    const eng = makeEngine({ d: { type: "date", maxAgeDays: 1 } });

    test("passes exactly at NOW (age = 0)", () => expectPass(eng.evaluate({ d: NOW }, OPT)));
    test("passes exactly 1 day ago (at boundary)", async () => {
      await expectPass(eng.evaluate({ d: daysFromNow(-1) }, OPT));
    });
    test("fails at 2 days ago (over boundary)", async () => {
      await expectFail(eng.evaluate({ d: daysFromNow(-2) }, OPT), "d", "maxAgeDays");
    });
  });

  describe("mustBeFuture", () => {
    const eng = makeEngine({ d: { type: "date", mustBeFuture: true } });

    test("passes future date", () => expectPass(eng.evaluate({ d: daysFromNow(1) }, OPT)));
    test("fails NOW (not strictly future)", () => expectFail(eng.evaluate({ d: NOW }, OPT), "d", "mustBeFuture"));
    test("fails past date", () => expectFail(eng.evaluate({ d: daysFromNow(-1) }, OPT), "d", "mustBeFuture"));
  });

  describe("mustBePast", () => {
    const eng = makeEngine({ d: { type: "date", mustBePast: true } });

    test("passes past date", () => expectPass(eng.evaluate({ d: daysFromNow(-1) }, OPT)));
    test("fails NOW (not strictly past)", () => expectFail(eng.evaluate({ d: NOW }, OPT), "d", "mustBePast"));
    test("fails future date", () => expectFail(eng.evaluate({ d: daysFromNow(1) }, OPT), "d", "mustBePast"));
  });

  describe("now override", () => {
    const eng = makeEngine({ d: { type: "date", mustBeFuture: true } });

    test("past date passes when now is set even further back", async () => {
      await expectPass(eng.evaluate({ d: new Date("2000-01-01") }, { now: new Date("1999-01-01") }));
    });
    test("far-future date fails when now is set past it", async () => {
      await expectFail(
        eng.evaluate({ d: new Date("2099-12-31") }, { now: new Date("2100-01-01") }),
        "d", "mustBeFuture",
      );
    });
  });

  describe("epoch and special dates", () => {
    test("handles date at Unix epoch", async () => {
      const eng = makeEngine({ d: { type: "date", after: "1969-12-31", before: "1970-01-02" } });
      await expectPass(eng.evaluate({ d: new Date("1970-01-01") }, OPT));
    });
  });

  describe("nullable combined with date rule", () => {
    const eng = makeEngine({ d: { type: "date", nullable: false, mustBePast: true } });

    test("passes past date", () => expectPass(eng.evaluate({ d: daysFromNow(-1) }, OPT)));
    test("missing field throws before mustBePast when absent", async () => {
      await expectMissingField(() => eng.evaluate({}, OPT), "d");
    });
    test("fails mustBePast for future date", () => expectFail(eng.evaluate({ d: daysFromNow(5) }, OPT), "d", "mustBePast"));
  });
});

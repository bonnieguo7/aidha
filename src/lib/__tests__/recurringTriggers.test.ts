import { planRepeatingTriggers } from "../recurringTriggers";

// Nov 17 2026 is a Tuesday. All local wall-clock.
const at = (s: string) => new Date(s);

describe("planRepeatingTriggers", () => {
  it("daily: one trigger at the occurrence's time of day", () => {
    expect(planRepeatingTriggers("daily", null, at("2026-11-17T08:30:00"))).toEqual([
      { kind: "daily", hour: 8, minute: 30 },
    ]);
  });

  describe("weekly", () => {
    it("uses the weekday in the detail (expo weekdays are 1-7 with 1 = Sunday)", () => {
      expect(planRepeatingTriggers("weekly", "day_of_week:monday", at("2026-11-17T18:00:00"))).toEqual([
        { kind: "weekly", weekday: 2, hour: 18, minute: 0 },
      ]);
      expect(planRepeatingTriggers("weekly", "day_of_week:sunday", at("2026-11-17T18:00:00"))).toEqual([
        { kind: "weekly", weekday: 1, hour: 18, minute: 0 },
      ]);
      expect(planRepeatingTriggers("weekly", "day_of_week:saturday", at("2026-11-17T18:00:00"))).toEqual([
        { kind: "weekly", weekday: 7, hour: 18, minute: 0 },
      ]);
    });

    it("makes one trigger per weekday for a list, in weekday order", () => {
      expect(planRepeatingTriggers("weekly", "day_of_week:thursday,monday", at("2026-11-17T09:15:00"))).toEqual([
        { kind: "weekly", weekday: 2, hour: 9, minute: 15 },
        { kind: "weekly", weekday: 5, hour: 9, minute: 15 },
      ]);
    });

    it("falls back to the occurrence's own weekday when the detail is empty or unparseable", () => {
      const tuesday = [{ kind: "weekly", weekday: 3, hour: 12, minute: 0 }];
      expect(planRepeatingTriggers("weekly", null, at("2026-11-17T12:00:00"))).toEqual(tuesday);
      expect(planRepeatingTriggers("weekly", "every other whenever", at("2026-11-17T12:00:00"))).toEqual(tuesday);
    });
  });

  describe("monthly", () => {
    it("uses day_of_month from the detail, or the occurrence's own day", () => {
      expect(planRepeatingTriggers("monthly", "day_of_month:1", at("2026-11-17T09:00:00"))).toEqual([
        { kind: "monthly", day: 1, hour: 9, minute: 0 },
      ]);
      expect(planRepeatingTriggers("monthly", null, at("2026-11-17T09:00:00"))).toEqual([
        { kind: "monthly", day: 17, hour: 9, minute: 0 },
      ]);
    });

    it("keeps the 28th as a plain monthly trigger", () => {
      expect(planRepeatingTriggers("monthly", "day_of_month:28", at("2026-11-17T09:00:00"))).toHaveLength(1);
    });

    it("spreads the 29th-31st over all twelve months, clamped to each month's length", () => {
      const triggers = planRepeatingTriggers("monthly", "day_of_month:31", at("2026-11-17T09:00:00"));
      expect(triggers).toHaveLength(12);
      expect(triggers.every((t) => t.kind === "yearly")).toBe(true);
      const days = triggers.map((t) => (t.kind === "yearly" ? t.day : -1));
      expect(days).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
      // months 0..11, each exactly once
      expect(triggers.map((t) => (t.kind === "yearly" ? t.month : -1))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    });

    it("clamps the 30th in February only", () => {
      const days = planRepeatingTriggers("monthly", "day_of_month:30", at("2026-11-17T09:00:00")).map((t) =>
        t.kind === "yearly" ? t.day : -1
      );
      expect(days).toEqual([30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]);
    });
  });

  describe("yearly", () => {
    it("fires on the occurrence's month and day (month is 0-based)", () => {
      expect(planRepeatingTriggers("yearly", null, at("2026-11-17T09:00:00"))).toEqual([
        { kind: "yearly", month: 10, day: 17, hour: 9, minute: 0 },
      ]);
    });

    it("moves a Feb 29 anniversary to Feb 28 so it fires every year", () => {
      expect(planRepeatingTriggers("yearly", null, at("2028-02-29T09:00:00"))).toEqual([
        { kind: "yearly", month: 1, day: 28, hour: 9, minute: 0 },
      ]);
    });
  });
});

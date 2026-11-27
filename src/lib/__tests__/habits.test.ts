import {
  cadenceLabel,
  finalizeHabit,
  habitProgress,
  nextPeriodStart,
  periodStart,
  planHabitReminders,
  progressLabel,
  reminderBody,
  streakLabel,
} from "../habits";

// Local wall-clock. Nov 26 2026 is a Thursday.
const at = (s: string) => new Date(s);
const iso = (s: string) => at(s).toISOString();
const NOW = at("2026-11-26T15:00:00");

const daily = { cadence: "daily" as const, target_count: 1 };
const weekly = { cadence: "weekly" as const, target_count: 1 };
const threeAWeek = { cadence: "weekly" as const, target_count: 3 };
const monthly = { cadence: "monthly" as const, target_count: 1 };

describe("periods", () => {
  it("starts a day at midnight, a week on Monday, a month on the 1st", () => {
    expect(periodStart("daily", NOW)).toEqual(at("2026-11-26T00:00:00"));
    expect(periodStart("weekly", NOW)).toEqual(at("2026-11-23T00:00:00"));
    expect(periodStart("monthly", NOW)).toEqual(at("2026-11-01T00:00:00"));
  });

  it("steps to the next period", () => {
    expect(nextPeriodStart("daily", at("2026-11-26T00:00:00"))).toEqual(at("2026-11-27T00:00:00"));
    expect(nextPeriodStart("weekly", at("2026-11-23T00:00:00"))).toEqual(at("2026-11-30T00:00:00"));
    expect(nextPeriodStart("monthly", at("2026-12-01T00:00:00"))).toEqual(at("2027-01-01T00:00:00"));
  });
});

describe("habitProgress", () => {
  it("counts this period's check-ins toward the goal", () => {
    const p = habitProgress(threeAWeek, [iso("2026-11-24T09:00:00"), iso("2026-11-26T08:00:00")], NOW);
    expect(p).toMatchObject({ done: 2, target: 3, met: false });
  });

  it("counts a daily streak including today once it's done", () => {
    const checkins = ["2026-11-26T08:00:00", "2026-11-25T21:00:00", "2026-11-24T07:00:00"].map(iso);
    expect(habitProgress(daily, checkins, NOW)).toMatchObject({ met: true, streak: 3 });
  });

  it("doesn't break the streak just because today isn't done yet", () => {
    const checkins = ["2026-11-25T21:00:00", "2026-11-24T07:00:00"].map(iso);
    expect(habitProgress(daily, checkins, NOW)).toMatchObject({ met: false, streak: 2 });
  });

  it("ends the streak at a missed period", () => {
    // Nothing on the 24th.
    const checkins = ["2026-11-26T08:00:00", "2026-11-25T21:00:00", "2026-11-23T07:00:00"].map(iso);
    expect(habitProgress(daily, checkins, NOW).streak).toBe(2);
  });

  it("needs the full goal in each period for a weekly streak", () => {
    const checkins = [
      // Last week: 3 - met.
      "2026-11-16T09:00:00", "2026-11-18T09:00:00", "2026-11-22T09:00:00",
      // The week before: only 2 - not met.
      "2026-11-10T09:00:00", "2026-11-12T09:00:00",
    ].map(iso);
    expect(habitProgress(threeAWeek, checkins, NOW)).toMatchObject({ done: 0, met: false, streak: 1 });
  });

  it("stops counting a streak at the edge of the loaded history", () => {
    const checkins = ["2026-11-26T08:00:00", "2026-11-25T08:00:00", "2026-11-24T08:00:00"].map(iso);
    expect(habitProgress(daily, checkins, NOW, at("2026-11-25T00:00:00")).streak).toBe(2);
  });

  it("caps done at the goal", () => {
    const checkins = ["2026-11-24T09:00:00", "2026-11-25T09:00:00"].map(iso);
    expect(habitProgress(weekly, checkins, NOW)).toMatchObject({ done: 1, met: true, streak: 1 });
  });
});

describe("labels", () => {
  it("describes the cadence", () => {
    expect(cadenceLabel("daily", 1)).toBe("Every day");
    expect(cadenceLabel("daily", 2)).toBe("Twice a day");
    expect(cadenceLabel("weekly", 1)).toBe("Once a week");
    expect(cadenceLabel("weekly", 3)).toBe("3× a week");
    expect(cadenceLabel("monthly", 1)).toBe("Once a month");
  });

  it("describes progress and streaks", () => {
    expect(progressLabel("weekly", { done: 1, target: 3, met: false, streak: 0 })).toBe("1 of 3 this week");
    expect(progressLabel("daily", { done: 1, target: 1, met: true, streak: 4 })).toBe("Done today");
    expect(streakLabel("daily", 1)).toBe("1 day");
    expect(streakLabel("weekly", 4)).toBe("4 weeks");
  });
});

describe("planHabitReminders", () => {
  const withTime = <T extends object>(h: T, reminder_time: string | null = "20:00") => ({ ...h, reminder_time });

  it("plans nothing without a reminder time", () => {
    expect(planHabitReminders(withTime(daily, null), [], NOW, 7)).toEqual([]);
  });

  it("reminds a daily habit every day it isn't done, starting today", () => {
    const dates = planHabitReminders(withTime(daily), [], NOW, 3).map((r) => r.date);
    expect(dates).toEqual([at("2026-11-26T20:00:00"), at("2026-11-27T20:00:00"), at("2026-11-28T20:00:00")]);
  });

  it("skips today once today's goal is met, and times already past", () => {
    const dates = planHabitReminders(withTime(daily), [iso("2026-11-26T08:00:00")], NOW, 2).map((r) => r.date);
    expect(dates).toEqual([at("2026-11-27T20:00:00")]);
    const morning = planHabitReminders(withTime(daily, "09:00"), [], NOW, 2).map((r) => r.date);
    expect(morning).toEqual([at("2026-11-27T09:00:00")]);
  });

  it("reminds a once-a-week habit on Saturday and Sunday", () => {
    const dates = planHabitReminders(withTime(weekly), [], NOW, 7).map((r) => r.date);
    expect(dates).toEqual([at("2026-11-28T20:00:00"), at("2026-11-29T20:00:00")]);
  });

  it("starts earlier for a bigger weekly goal, and not at all once it's met", () => {
    const dates = planHabitReminders(withTime(threeAWeek), [], NOW, 4).map((r) => r.date);
    // Thursday (4 days left incl. today) through Sunday.
    expect(dates).toEqual(["26", "27", "28", "29"].map((d) => at(`2026-11-${d}T20:00:00`)));

    const met = ["2026-11-23T09:00:00", "2026-11-24T09:00:00", "2026-11-25T09:00:00"].map(iso);
    expect(planHabitReminders(withTime(threeAWeek), met, NOW, 4)).toEqual([]);
  });

  it("reminds a monthly habit on the last two days of the month", () => {
    const dates = planHabitReminders(withTime(monthly), [], NOW, 7).map((r) => r.date);
    expect(dates).toEqual([at("2026-11-29T20:00:00"), at("2026-11-30T20:00:00")]);
  });

  it("writes a body that says what's left", () => {
    const [sat] = planHabitReminders(withTime(weekly), [], NOW, 7);
    expect(reminderBody("weekly", sat)).toBe("1 more this week - 2 days left");
    const [today] = planHabitReminders(withTime(daily), [], NOW, 1);
    expect(reminderBody("daily", today)).toBe("Still to do today");
  });
});

describe("finalizeHabit", () => {
  it("clamps the goal to the cadence and tidies text", () => {
    expect(
      finalizeHabit({ title: "  Gym ", cadence: "weekly", target_count: 9, reminder_time: "nope", notes: "  " })
    ).toEqual({ title: "Gym", cadence: "weekly", target_count: 7, reminder_time: null, notes: null });
  });
});

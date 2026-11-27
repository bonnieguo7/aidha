import {
  completionMessage,
  countToday,
  monthlyCounts,
  startOfMonth,
  startOfWeek,
  weeklyCounts,
} from "../accomplishments";

// Local wall-clock. Nov 26 2026 is a Thursday.
const at = (s: string) => new Date(s);
const iso = (s: string) => at(s).toISOString();
const NOW = at("2026-11-26T15:00:00");

describe("startOfWeek / startOfMonth", () => {
  it("starts the week at Monday midnight", () => {
    expect(startOfWeek(NOW)).toEqual(at("2026-11-23T00:00:00"));
    expect(startOfWeek(at("2026-11-29T22:00:00"))).toEqual(at("2026-11-23T00:00:00")); // Sunday ends it
    expect(startOfWeek(at("2026-11-23T08:00:00"))).toEqual(at("2026-11-23T00:00:00")); // Monday is the start
  });

  it("starts the month on the 1st at midnight", () => {
    expect(startOfMonth(NOW)).toEqual(at("2026-11-01T00:00:00"));
  });
});

describe("weeklyCounts", () => {
  const times = [
    iso("2026-11-26T09:00:00"), // this week
    iso("2026-11-23T00:00:00"), // this week - Monday midnight is its first moment
    iso("2026-11-22T23:59:00"), // last week - Sunday night
    iso("2026-11-16T12:00:00"), // last week
    iso("2026-11-02T12:00:00"), // 4 weeks back
    iso("2026-09-01T12:00:00"), // too old for an 8-week window
  ];

  it("counts each Monday-Sunday week, oldest first, ending with this week", () => {
    const weeks = weeklyCounts(times, NOW, 4);
    expect(weeks.map((w) => w.start)).toEqual([
      at("2026-11-02T00:00:00"),
      at("2026-11-09T00:00:00"),
      at("2026-11-16T00:00:00"),
      at("2026-11-23T00:00:00"),
    ]);
    expect(weeks.map((w) => w.count)).toEqual([1, 0, 2, 2]);
    expect(weeks[3].end).toEqual(at("2026-11-30T00:00:00"));
  });

  it("leaves out anything older than the window", () => {
    const total = weeklyCounts(times, NOW, 8).reduce((sum, w) => sum + w.count, 0);
    expect(total).toBe(5);
  });

  it("ignores missing, unparseable and future times", () => {
    const weeks = weeklyCounts([null, "garbage", iso("2026-11-26T16:00:00")], NOW, 2);
    expect(weeks.map((w) => w.count)).toEqual([0, 0]);
  });
});

describe("monthlyCounts", () => {
  it("counts each calendar month, oldest first, ending with this month", () => {
    const months = monthlyCounts(
      [
        iso("2026-11-26T09:00:00"),
        iso("2026-11-01T00:00:00"), // first moment of November
        iso("2026-10-31T23:59:00"), // last moment of October
        iso("2026-09-15T12:00:00"),
      ],
      NOW,
      3
    );
    expect(months.map((m) => m.start)).toEqual([
      at("2026-09-01T00:00:00"),
      at("2026-10-01T00:00:00"),
      at("2026-11-01T00:00:00"),
    ]);
    expect(months.map((m) => m.count)).toEqual([1, 1, 2]);
    expect(months[2].end).toEqual(at("2026-12-01T00:00:00"));
  });

  it("crosses a year boundary", () => {
    const months = monthlyCounts([iso("2026-12-15T12:00:00")], at("2027-01-10T12:00:00"), 2);
    expect(months.map((m) => m.start)).toEqual([at("2026-12-01T00:00:00"), at("2027-01-01T00:00:00")]);
    expect(months.map((m) => m.count)).toEqual([1, 0]);
  });
});

describe("countToday", () => {
  it("counts only today's completions", () => {
    expect(countToday([iso("2026-11-26T00:00:00"), iso("2026-11-26T14:00:00"), iso("2026-11-25T23:59:00")], NOW)).toBe(2);
  });
});

describe("completionMessage", () => {
  it("celebrates the first one of the day, then counts up with a bigger cheer every fifth", () => {
    expect(completionMessage(1)).toBe("First one done today 🎯");
    expect(completionMessage(3)).toBe("3 done today ✨");
    expect(completionMessage(5)).toBe("5 done today - on a roll! 🔥");
  });
});

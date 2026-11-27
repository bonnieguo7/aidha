import { parseWeekdays } from "../recurrence";
import { describeRecurrence, weeklyDays, weeklyDetail } from "../recurrenceLabel";

const FRIDAY = new Date("2026-11-27T18:00:00");

describe("weeklyDays / weeklyDetail", () => {
  it("reads the days from the detail, Monday first", () => {
    expect(weeklyDays("day_of_week:sunday,monday", FRIDAY)).toEqual([1, 0]);
  });

  it("falls back to the date's own weekday", () => {
    expect(weeklyDays(null, FRIDAY)).toEqual([5]);
    expect(weeklyDays(null, null)).toEqual([]);
  });

  it("writes a detail the reminders can read back", () => {
    const detail = weeklyDetail([4, 1]);
    expect(detail).toBe("day_of_week:monday,thursday");
    expect([...parseWeekdays(detail)].sort()).toEqual([1, 4]);
    expect(weeklyDetail([])).toBeNull();
  });
});

describe("describeRecurrence", () => {
  it("describes each kind of repeat", () => {
    expect(describeRecurrence(null, null, FRIDAY)).toBe("Doesn't repeat");
    expect(describeRecurrence("daily", null, FRIDAY)).toBe("Every day");
    expect(describeRecurrence("weekly", null, FRIDAY)).toBe("Every week on Fri");
    expect(describeRecurrence("weekly", "day_of_week:monday,thursday", FRIDAY)).toBe("Every week on Mon, Thu");
    expect(describeRecurrence("monthly", "day_of_month:1", FRIDAY)).toBe("Every month on the 1st");
    expect(describeRecurrence("monthly", null, FRIDAY)).toBe("Every month on the 27th");
    expect(describeRecurrence("monthly", "day_of_month:12", FRIDAY)).toBe("Every month on the 12th");
    expect(describeRecurrence("yearly", null, null)).toBe("Every year");
  });
});

import { parseDayOfMonth, parseWeekdays } from "./recurrence";
import type { RecurringFrequency } from "../types/task";

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Weeks read Monday first, matching the rest of the app.
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

// The weekdays a weekly repeat falls on: the ones named in its detail, or the
// date's own weekday when none are (the same rule the reminders use).
export function weeklyDays(detail: string | null, anchor: Date | null): number[] {
  const parsed = parseWeekdays(detail);
  if (parsed.size > 0) return WEEK_ORDER.filter((d) => parsed.has(d));
  return anchor ? [anchor.getDay()] : [];
}

// The stored detail for a weekly repeat on these weekdays, e.g.
// "day_of_week:monday,thursday". Null for none (then the date's weekday is used).
export function weeklyDetail(days: number[]): string | null {
  const ordered = WEEK_ORDER.filter((d) => days.includes(d));
  return ordered.length > 0 ? `day_of_week:${ordered.map((d) => WEEKDAY_NAMES[d]).join(",")}` : null;
}

// "Every day", "Every week on Mon, Thu", "Every month on the 27th", "Every year on Nov 27".
export function describeRecurrence(
  frequency: RecurringFrequency | null,
  detail: string | null,
  anchor: Date | null
): string {
  switch (frequency) {
    case null:
      return "Doesn't repeat";
    case "daily":
      return "Every day";
    case "weekly": {
      const days = weeklyDays(detail, anchor);
      if (days.length === 7) return "Every day of the week";
      return days.length > 0 ? `Every week on ${days.map((d) => WEEKDAY_SHORT[d]).join(", ")}` : "Every week";
    }
    case "monthly": {
      const day = parseDayOfMonth(detail) ?? anchor?.getDate() ?? null;
      return day ? `Every month on the ${ordinal(day)}` : "Every month";
    }
    case "yearly":
      return anchor
        ? `Every year on ${anchor.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
        : "Every year";
  }
}

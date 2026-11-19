import type { RecurringFrequency } from "../types/task";
import { parseDayOfMonth, parseWeekdays } from "./recurrence";

// One repeating notification trigger, in the same terms expo-notifications uses
// (weekday 1-7 with 1 = Sunday; month 0-11) so it maps straight onto its
// DAILY / WEEKLY / MONTHLY / YEARLY trigger inputs.
export type RepeatingTrigger =
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; weekday: number; hour: number; minute: number }
  | { kind: "monthly"; day: number; hour: number; minute: number }
  | { kind: "yearly"; month: number; day: number; hour: number; minute: number };

// Days in each month of a non-leap year, indexed by month 0-11. Feb is 28 on
// purpose: a "Feb 29" or "the 29th/30th/31st" reminder is placed on the last day
// of the month in a normal year, and so lands one day early (the 28th) in a leap
// February - better than skipping the month the way a literal "day 31" would.
const SHORTEST_MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// Which repeating triggers a recurring item needs, from its repeat rule and the
// time of day on its current occurrence. Mirrors how computeNextOccurrence reads
// the same rule (weekdays from the detail or the anchor's own weekday, "the Nth"
// or the anchor's day, and so on), so reminders fire on the days the next
// occurrences will fall on. Weekly rules with several days need one trigger per
// day; a day-of-month past the 28th needs one per month (see above).
export function planRepeatingTriggers(
  frequency: RecurringFrequency,
  detail: string | null,
  anchor: Date
): RepeatingTrigger[] {
  const hour = anchor.getHours();
  const minute = anchor.getMinutes();

  switch (frequency) {
    case "daily":
      return [{ kind: "daily", hour, minute }];

    case "weekly": {
      const parsed = parseWeekdays(detail);
      const days = parsed.size > 0 ? [...parsed] : [anchor.getDay()];
      return days
        .sort((a, b) => a - b)
        .map((day) => ({ kind: "weekly" as const, weekday: day + 1, hour, minute }));
    }

    case "monthly": {
      const day = parseDayOfMonth(detail) ?? anchor.getDate();
      if (day <= 28) return [{ kind: "monthly", day, hour, minute }];
      return SHORTEST_MONTH_LENGTHS.map((length, month) => ({
        kind: "yearly" as const,
        month,
        day: Math.min(day, length),
        hour,
        minute,
      }));
    }

    case "yearly": {
      const month = anchor.getMonth();
      return [{ kind: "yearly", month, day: Math.min(anchor.getDate(), SHORTEST_MONTH_LENGTHS[month]), hour, minute }];
    }
  }
}

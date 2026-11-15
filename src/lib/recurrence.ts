import type { RecurringFrequency } from "../types/task";

// Used when a recurring task has no time of its own (a "whenever" task) - same
// 9am default snoozeTask uses when it has to invent a concrete time.
const DEFAULT_HOUR = 9;

const WEEKDAY_PREFIXES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// interval_detail is free text written by the model, usually "day_of_week:monday"
// or "day_of_month:1" (see the extract_task tool schema) but not guaranteed -
// "day_of_week:monday,thursday" is a reasonable thing for it to produce too.
// Anything unparseable returns an empty set and the caller falls back to the
// anchor date's own weekday / day-of-month.
function parseWeekdays(detail: string | null): Set<number> {
  const days = new Set<number>();
  if (!detail) return days;
  for (const match of detail.toLowerCase().matchAll(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*/g)) {
    days.add(WEEKDAY_PREFIXES.indexOf(match[1]));
  }
  return days;
}

function parseDayOfMonth(detail: string | null): number | null {
  const match = detail ? /day_of_month:\s*(\d{1,2})/i.exec(detail) : null;
  if (!match) return null;
  const day = Number(match[1]);
  return day >= 1 && day <= 31 ? day : null;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

// Plain local-time constructor - day/month overflow rolls forward naturally
// (day 32 of January is Feb 1), which is what daily/weekly stepping wants.
function atTime(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(year, month, day, hour, minute);
}

// For "the 31st" / "Feb 29": lands on the last day of shorter months instead of
// overflowing into the next month. Normalizes month overflow (month 13 is
// February of the next year) before measuring how long that month is.
function clampedAtTime(year: number, month: number, day: number, hour: number, minute: number): Date {
  const normalized = new Date(year, month, 1);
  const lastDay = daysInMonth(normalized.getFullYear(), normalized.getMonth());
  return new Date(normalized.getFullYear(), normalized.getMonth(), Math.min(day, lastDay), hour, minute);
}

// When a recurring task's next instance is due, given the instance that was
// just completed. Always strictly later than both the completed instance's own
// datetime and `now`, so completing early doesn't schedule the same occurrence
// again and completing late (a weekly task finished 3 days overdue) jumps to the
// next future occurrence instead of one that's already in the past.
//
// `anchor` is the completed instance's datetime; null for a "whenever" task,
// in which case the time of day defaults to 9am and the next occurrence must
// fall on a later calendar day than today (otherwise a daily task ticked off
// at 7am would immediately be due again at 9am the same day).
export function computeNextOccurrence(
  frequency: RecurringFrequency,
  detail: string | null,
  anchor: Date | null,
  now: Date = new Date()
): Date {
  const hasAnchor = anchor !== null && !Number.isNaN(anchor.getTime());
  const hour = hasAnchor ? anchor.getHours() : DEFAULT_HOUR;
  const minute = hasAnchor ? anchor.getMinutes() : 0;
  const reference = hasAnchor ? anchor : now;

  const threshold = hasAnchor
    ? new Date(Math.max(anchor.getTime(), now.getTime()))
    : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const year = threshold.getFullYear();
  const month = threshold.getMonth();
  const day = threshold.getDate();

  switch (frequency) {
    case "daily": {
      for (let offset = 0; ; offset++) {
        const candidate = atTime(year, month, day + offset, hour, minute);
        if (candidate > threshold) return candidate;
      }
    }

    case "weekly": {
      const parsed = parseWeekdays(detail);
      const weekdays = parsed.size > 0 ? parsed : new Set([reference.getDay()]);
      for (let offset = 0; offset <= 7; offset++) {
        const candidate = atTime(year, month, day + offset, hour, minute);
        if (candidate > threshold && weekdays.has(candidate.getDay())) return candidate;
      }
      // Unreachable: a non-empty weekday set always matches within 7 days.
      return atTime(year, month, day + 7, hour, minute);
    }

    case "monthly": {
      const dayOfMonth = parseDayOfMonth(detail) ?? reference.getDate();
      for (let offset = 0; ; offset++) {
        const candidate = clampedAtTime(year, month + offset, dayOfMonth, hour, minute);
        if (candidate > threshold) return candidate;
      }
    }

    case "yearly": {
      for (let offset = 0; ; offset++) {
        const candidate = clampedAtTime(year + offset, reference.getMonth(), reference.getDate(), hour, minute);
        if (candidate > threshold) return candidate;
      }
    }
  }
}

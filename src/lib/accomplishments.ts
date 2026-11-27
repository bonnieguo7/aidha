// The numbers behind the profile's completed-task counts and the "done today"
// toast. Only tasks the user checks off count - events archive themselves when
// their time passes, so the app can't tell whether the user actually went.

// One week or month and how many tasks were completed in it.
export interface PeriodCount {
  start: Date;
  // Exclusive: the first moment of the next period.
  end: Date;
  count: number;
}

// Midnight starting the Monday of `now`'s week, local time.
export function startOfWeek(now: Date): Date {
  const daysSinceMonday = (now.getDay() + 6) % 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);
}

// Midnight on the first of `now`'s month, local time.
export function startOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function toTimes(completedAts: (string | null)[], now: Date): number[] {
  const end = now.getTime();
  return completedAts
    .map((value) => (value ? new Date(value).getTime() : NaN))
    .filter((t) => !Number.isNaN(t) && t <= end);
}

function countBetween(times: number[], from: Date, to: Date): number {
  const a = from.getTime();
  const b = to.getTime();
  return times.filter((t) => t >= a && t < b).length;
}

// Completions in each of the last `weeks` weeks (Monday-Sunday), oldest first;
// the last entry is the current week. Missing, unparseable and future times are
// ignored.
export function weeklyCounts(completedAts: (string | null)[], now: Date, weeks: number): PeriodCount[] {
  const times = toTimes(completedAts, now);
  const thisWeek = startOfWeek(now);
  return Array.from({ length: weeks }, (_, i) => {
    const back = weeks - 1 - i;
    // Built from calendar dates (not milliseconds) so a daylight-saving change
    // can't shift a week boundary off midnight.
    const start = new Date(thisWeek.getFullYear(), thisWeek.getMonth(), thisWeek.getDate() - 7 * back);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
    return { start, end, count: countBetween(times, start, end) };
  });
}

// Completions in each of the last `months` calendar months, oldest first; the
// last entry is the current month.
export function monthlyCounts(completedAts: (string | null)[], now: Date, months: number): PeriodCount[] {
  const times = toTimes(completedAts, now);
  return Array.from({ length: months }, (_, i) => {
    const back = months - 1 - i;
    const start = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    return { start, end, count: countBetween(times, start, end) };
  });
}

export function countToday(completedAts: (string | null)[], now: Date): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return countBetween(toTimes(completedAts, now), today, tomorrow);
}

// The short line shown when the user ticks something off.
export function completionMessage(todayCount: number): string {
  if (todayCount <= 1) return "First one done today 🎯";
  if (todayCount % 5 === 0) return `${todayCount} done today - on a roll! 🔥`;
  return `${todayCount} done today ✨`;
}

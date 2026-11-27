import type { HabitCadence, HabitCheckin, HabitDraft } from "../types/habit";
import { startOfMonth, startOfWeek } from "./accomplishments";

// Pure habit logic: periods, progress, streaks and when to send reminders. All
// in local time - a "day" is the user's calendar day, weeks run Monday-Sunday.

export const MAX_TARGET: Record<HabitCadence, number> = { daily: 10, weekly: 7, monthly: 31 };

export function periodStart(cadence: HabitCadence, date: Date): Date {
  if (cadence === "weekly") return startOfWeek(date);
  if (cadence === "monthly") return startOfMonth(date);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// The first moment of the period after the one starting at `start`. Built from
// calendar fields so daylight-saving changes can't push it off midnight.
export function nextPeriodStart(cadence: HabitCadence, start: Date): Date {
  if (cadence === "monthly") return new Date(start.getFullYear(), start.getMonth() + 1, 1);
  const days = cadence === "weekly" ? 7 : 1;
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + days);
}

function previousPeriodStart(cadence: HabitCadence, start: Date): Date {
  if (cadence === "monthly") return new Date(start.getFullYear(), start.getMonth() - 1, 1);
  const days = cadence === "weekly" ? 7 : 1;
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() - days);
}

function toTimes(completedAts: string[]): number[] {
  return completedAts.map((s) => new Date(s).getTime()).filter((t) => !Number.isNaN(t));
}

function countIn(times: number[], from: Date, to: Date): number {
  const a = from.getTime();
  const b = to.getTime();
  return times.filter((t) => t >= a && t < b).length;
}

export interface HabitProgress {
  done: number;
  target: number;
  met: boolean;
  // Consecutive periods with the goal met, ending with the current one if it's
  // already met, or the one before if it isn't (the current period still has
  // time left, so it doesn't break the streak yet).
  streak: number;
}

// `lookbackStart` is how far back the check-ins were loaded: a streak that
// reaches it may really be longer, so it stops counting there.
export function habitProgress(
  habit: { cadence: HabitCadence; target_count: number },
  completedAts: string[],
  now: Date,
  lookbackStart?: Date
): HabitProgress {
  const times = toTimes(completedAts);
  const target = habit.target_count;
  const current = periodStart(habit.cadence, now);
  const done = countIn(times, current, nextPeriodStart(habit.cadence, current));
  const met = done >= target;

  let streak = met ? 1 : 0;
  let start = previousPeriodStart(habit.cadence, current);
  const floor = lookbackStart?.getTime() ?? -Infinity;
  while (start.getTime() >= floor) {
    const end = nextPeriodStart(habit.cadence, start);
    if (countIn(times, start, end) < target) break;
    streak += 1;
    start = previousPeriodStart(habit.cadence, start);
  }
  return { done: Math.min(done, target), target, met, streak };
}

// The most recent check-in in the current period - what unchecking a habit
// removes. Null if there's none this period (an older one is left alone: undoing
// last week's check-in from today's list would be surprising).
export function latestCheckinThisPeriod(
  cadence: HabitCadence,
  checkins: HabitCheckin[],
  now: Date
): HabitCheckin | null {
  const start = periodStart(cadence, now).getTime();
  const end = nextPeriodStart(cadence, periodStart(cadence, now)).getTime();
  let latest: HabitCheckin | null = null;
  for (const c of checkins) {
    const t = new Date(c.completed_at).getTime();
    if (t < start || t >= end) continue;
    if (!latest || t > new Date(latest.completed_at).getTime()) latest = c;
  }
  return latest;
}

const UNIT: Record<HabitCadence, [string, string]> = {
  daily: ["day", "days"],
  weekly: ["week", "weeks"],
  monthly: ["month", "months"],
};

export function streakLabel(cadence: HabitCadence, streak: number): string {
  const [one, many] = UNIT[cadence];
  return `${streak} ${streak === 1 ? one : many}`;
}

const PERIOD_WORD: Record<HabitCadence, string> = { daily: "day", weekly: "week", monthly: "month" };

// "Every day", "Twice a day", "Once a week", "3× a week", "Once a month".
export function cadenceLabel(cadence: HabitCadence, target: number): string {
  if (cadence === "daily" && target === 1) return "Every day";
  const times = target === 1 ? "Once" : target === 2 ? "Twice" : `${target}×`;
  return `${times} a ${PERIOD_WORD[cadence]}`;
}

// "today", "this week", "this month".
export function periodPhrase(cadence: HabitCadence): string {
  return cadence === "daily" ? "today" : `this ${PERIOD_WORD[cadence]}`;
}

// "1 of 3 this week", "Done today".
export function progressLabel(cadence: HabitCadence, progress: HabitProgress): string {
  const period = periodPhrase(cadence);
  if (progress.met) return `Done ${period}`;
  return `${progress.done} of ${progress.target} ${period}`;
}

function parseReminderTime(value: string | null): { hour: number; minute: number } | null {
  const match = value ? /^(\d{2}):(\d{2})$/.exec(value) : null;
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? { hour, minute } : null;
}

export interface PlannedReminder {
  date: Date;
  // Check-ins still needed in that period when the reminder fires, assuming
  // none happen before then (reminders are re-planned after every check-in).
  remaining: number;
  // Days left in the period, counting the reminder's own day.
  daysLeft: number;
}

// When to remind the user about a habit over the next `horizonDays` days. A
// daily habit is reminded every day it isn't done yet. A weekly or monthly one
// only once time is running short: on a day when the check-ins still needed
// are at least the days left minus one - so "once a week" is reminded on
// Saturday and Sunday, "3× a week" from Thursday. Never in a period whose goal
// is already met.
export function planHabitReminders(
  habit: { cadence: HabitCadence; target_count: number; reminder_time: string | null },
  completedAts: string[],
  now: Date,
  horizonDays: number
): PlannedReminder[] {
  const time = parseReminderTime(habit.reminder_time);
  if (!time) return [];

  const times = toTimes(completedAts);
  const slack = habit.cadence === "daily" ? 0 : 1;
  const reminders: PlannedReminder[] = [];
  for (let i = 0; i < horizonDays; i++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, time.hour, time.minute);
    if (date.getTime() <= now.getTime()) continue;

    const start = periodStart(habit.cadence, date);
    const end = nextPeriodStart(habit.cadence, start);
    const remaining = habit.target_count - countIn(times, start, end);
    if (remaining <= 0) continue;

    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const daysLeft = Math.round((end.getTime() - day.getTime()) / 86_400_000);
    if (daysLeft <= remaining + slack) reminders.push({ date, remaining, daysLeft });
  }
  return reminders;
}

export function reminderBody(cadence: HabitCadence, reminder: PlannedReminder): string {
  if (cadence === "daily") return reminder.remaining > 1 ? `${reminder.remaining} more to go today` : "Still to do today";
  const left = reminder.daysLeft === 1 ? "last day" : `${reminder.daysLeft} days left`;
  return `${reminder.remaining} more this ${PERIOD_WORD[cadence]} - ${left}`;
}

export function blankHabit(): HabitDraft {
  return { title: "", cadence: "daily", target_count: 1, reminder_time: null, notes: null };
}

// Clamps the goal to what fits the cadence (no "8× a week") and tidies text.
export function finalizeHabit(draft: HabitDraft): HabitDraft {
  const target = Math.min(Math.max(1, Math.round(draft.target_count) || 1), MAX_TARGET[draft.cadence]);
  return {
    title: draft.title.trim(),
    cadence: draft.cadence,
    target_count: target,
    reminder_time: parseReminderTime(draft.reminder_time) ? draft.reminder_time : null,
    notes: draft.notes?.trim() || null,
  };
}

// "8:00 PM" for a "20:00" reminder.
export function formatReminderTime(value: string | null): string | null {
  const time = parseReminderTime(value);
  if (!time) return null;
  return new Date(2000, 0, 1, time.hour, time.minute).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

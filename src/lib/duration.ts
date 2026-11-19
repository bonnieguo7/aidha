import type { TaskRow } from "../types/task";

// What the Day view assumes for an event that has no stored duration.
export const DEFAULT_EVENT_MINUTES = 60;
export const MIN_DURATION_MINUTES = 5;
export const MAX_DURATION_MINUTES = 24 * 60;
// One-tap choices in the duration editors.
export const DURATION_PRESETS = [30, 60, 90, 120, 180] as const;

type TimedTask = Pick<TaskRow, "datetime" | "duration_minutes">;

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

// Whole minutes from a typed value like "90" (or " 45 min "), or null if it
// isn't a usable duration.
export function parseDurationInput(text: string): number | null {
  const match = /^\s*(\d{1,4})\s*(?:m|min|mins|minutes)?\s*$/i.exec(text);
  if (!match) return null;
  const minutes = Number(match[1]);
  return minutes >= MIN_DURATION_MINUTES && minutes <= MAX_DURATION_MINUTES ? minutes : null;
}

// When a timed event or task is over. One with no stored duration ends the
// moment it starts, which is how everything behaved before durations existed -
// so nothing changes for it until a duration is set.
export function itemEnd(task: TimedTask): Date | null {
  if (!task.datetime) return null;
  const start = new Date(task.datetime);
  if (Number.isNaN(start.getTime())) return null;
  return new Date(start.getTime() + (task.duration_minutes ?? 0) * 60_000);
}

// True from an item's start until its end - never for one with no duration.
export function isInProgress(task: TimedTask, now: Date): boolean {
  if (!task.duration_minutes) return false;
  const end = itemEnd(task);
  const start = new Date(task.datetime!);
  return end !== null && start <= now && now < end;
}

import { DEPARTURE_RECHECK_WINDOW_MINUTES } from "./constants";
import { getCurrentUserLocation } from "./locationPermission";
import { updateDepartureForTask } from "./scheduleDeparture";
import type { TaskRow } from "../types/task";

// Active tasks/events with both a location and a datetime (the ones that
// have, or should have, a "leaving by" reminder) whose datetime is coming up
// within the recheck window.
function isDepartureRecheckCandidate(task: TaskRow, now: Date): boolean {
  if (task.is_completed || !task.location_raw_text || !task.datetime) return false;
  const eventTime = new Date(task.datetime);
  if (Number.isNaN(eventTime.getTime())) return false;
  const minutesUntil = (eventTime.getTime() - now.getTime()) / 60_000;
  return minutesUntil > 0 && minutesUntil <= DEPARTURE_RECHECK_WINDOW_MINUTES;
}

// Re-verifies the user's current location (and recomputes "leaving by") for
// any upcoming, close-in event that needs one - called every time the task
// list refreshes (screen focus or pull-to-refresh), so a "leaving by" set up
// earlier from a different location gets corrected as departure nears,
// instead of only ever being recomputed when the user happens to re-edit the
// task. Foreground-only: this can only run while the app is open, so a task
// never reopened before its event just keeps whatever "leaving by" was last
// computed - see getCurrentUserLocation for why there's no background path.
export async function refreshUpcomingDepartures(rows: TaskRow[]): Promise<TaskRow[]> {
  const now = new Date();
  const candidates = rows.filter((t) => isDepartureRecheckCandidate(t, now));
  if (candidates.length === 0) return rows;

  const userLocation = await getCurrentUserLocation();
  if (!userLocation) return rows;

  const updates = new Map<string, TaskRow>();
  for (const task of candidates) {
    updates.set(task.id, await updateDepartureForTask(task, userLocation));
  }

  return rows.map((t) => updates.get(t.id) ?? t);
}

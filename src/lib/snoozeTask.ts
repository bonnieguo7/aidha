import { getCurrentUserLocation } from "./locationPermission";
import { updateDepartureForTask } from "./scheduleDeparture";
import { supabase } from "./supabase";
import { syncDueNotification } from "./syncDueNotification";
import type { TaskRow } from "../types/task";

export type SnoozeOption = "1h" | "tomorrow" | "next_week";

// A task with no datetime has nothing to push forward from, so "now" stands in
// for it - the snoozed result becomes a concrete time going forward.
function computeSnoozedDatetime(task: TaskRow, option: SnoozeOption): Date {
  const next = task.datetime ? new Date(task.datetime) : new Date();

  switch (option) {
    case "1h":
      next.setTime(next.getTime() + 60 * 60 * 1000);
      break;
    case "tomorrow":
      next.setDate(next.getDate() + 1);
      if (!task.datetime) next.setHours(9, 0, 0, 0);
      break;
    case "next_week":
      next.setDate(next.getDate() + 7);
      if (!task.datetime) next.setHours(9, 0, 0, 0);
      break;
  }

  return next;
}

// Pushes a task's datetime forward by a preset amount and recomputes its
// "leaving by" reminder if it has a location - same background nicety
// EditTaskScreen applies after a manual date/time change.
export async function snoozeTask(task: TaskRow, option: SnoozeOption): Promise<TaskRow> {
  const nextDatetime = computeSnoozedDatetime(task, option);

  const { data, error } = await supabase
    .from("tasks")
    .update({ datetime: nextDatetime.toISOString(), date_certainty: "exact" })
    .eq("id", task.id)
    .select()
    .single();

  if (error || !data) return task;
  let updated = data as TaskRow;

  updated = await syncDueNotification(updated);

  if (updated.location_raw_text) {
    const userLocation = await getCurrentUserLocation();
    if (userLocation) {
      updated = await updateDepartureForTask(updated, userLocation);
    }
  }

  return updated;
}

import { cancelNotification, scheduleDueNotification } from "./notifications";
import { supabase } from "./supabase";
import type { TaskRow } from "../types/task";

async function applyPatch(task: TaskRow, patch: Record<string, unknown>): Promise<TaskRow> {
  const { data, error } = await supabase.from("tasks").update(patch).eq("id", task.id).select().single();
  if (error || !data) {
    console.error("syncDueNotification: failed to save notification id", error);
    return task;
  }
  return data as TaskRow;
}

// Keeps a task's "at the scheduled time" notification (see scheduleDueNotification)
// in sync with its current datetime and completion state - cancels whatever was
// there before and reschedules fresh, the same reschedule-from-scratch approach
// updateDepartureForTask already uses for "leaving by". Safe to call after any
// edit; a cheap no-op write when there's nothing to schedule and nothing
// previously scheduled to clear.
export async function syncDueNotification(task: TaskRow): Promise<TaskRow> {
  await cancelNotification(task.datetime_notification_id);

  if (!task.datetime || task.is_completed) {
    if (task.datetime_notification_id === null) return task;
    return applyPatch(task, { datetime_notification_id: null });
  }

  const notificationId = await scheduleDueNotification(task);
  return applyPatch(task, { datetime_notification_id: notificationId });
}

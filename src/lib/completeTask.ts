import { getCurrentUserLocation } from "./locationPermission";
import { cancelNotification } from "./notifications";
import { computeNextOccurrence } from "./recurrence";
import { updateDepartureForTask } from "./scheduleDeparture";
import { supabase } from "./supabase";
import { syncDueNotification } from "./syncDueNotification";
import type { TaskRow } from "../types/task";

// Inserts the next instance of a recurring task/event as a fresh row, with its
// own "at the scheduled time" and "leaving by" reminders. Returns null for a
// non-recurring task, or if the insert fails (logged, not thrown - the task
// being completed has already been saved by then, so there's nothing to roll
// back, and a missing next instance is better than a broken completion).
//
// Each completed instance stays in the archive as its own row rather than
// being rolled forward in place, so the Archive tab keeps a history of every
// time a recurring task was actually done.
export async function createNextOccurrence(task: TaskRow): Promise<TaskRow | null> {
  if (!task.recurring_frequency) return null;

  const nextDatetime = computeNextOccurrence(
    task.recurring_frequency,
    task.recurring_detail,
    task.datetime ? new Date(task.datetime) : null
  );

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: task.user_id,
      raw_input: task.raw_input,
      type: task.type,
      title: task.title,
      datetime: nextDatetime.toISOString(),
      date_certainty: "exact",
      location_raw_text: task.location_raw_text,
      location_place_type: task.location_place_type,
      recurring_frequency: task.recurring_frequency,
      recurring_detail: task.recurring_detail,
      priority: task.priority,
      requires_downtime: task.requires_downtime,
      duration_minutes: task.duration_minutes,
      notes: task.notes,
      latitude: task.latitude,
      longitude: task.longitude,
      resolved_address: task.resolved_address,
    })
    .select()
    .single();

  if (error || !data) {
    console.error("createNextOccurrence: failed to insert next instance", error);
    return null;
  }

  let next = await syncDueNotification(data as TaskRow);

  if (next.location_raw_text) {
    const userLocation = await getCurrentUserLocation();
    if (userLocation) {
      next = await updateDepartureForTask(next, userLocation);
    }
  }

  return next;
}

export interface CompleteTaskResult {
  next: TaskRow | null;
  error: string | null;
}

// Marks a task complete, cancels its reminders, and - if it repeats - creates
// the next occurrence. The update only matches a row that's still not
// completed and reports back which rows it actually changed: if another screen
// (or a second tap) completed it first, zero rows change and no duplicate
// "next" instance gets created.
export async function completeTask(task: TaskRow): Promise<CompleteTaskResult> {
  await cancelNotification(task.leaving_notification_id);
  await cancelNotification(task.datetime_notification_id);

  const { data, error } = await supabase
    .from("tasks")
    .update({ is_completed: true, leaving_notification_id: null, datetime_notification_id: null })
    .eq("id", task.id)
    .eq("is_completed", false)
    .select("id");

  if (error) return { next: null, error: error.message };
  if (!data || data.length === 0) return { next: null, error: null };

  return { next: await createNextOccurrence(task), error: null };
}

import { getScheduledRecurringMarkers, hasNotificationPermission, recurringMarker } from "./notifications";
import { syncDueNotification } from "./syncDueNotification";
import type { TaskRow } from "../types/task";

// Makes sure every active repeating item actually has its repeating reminder on
// this phone. Covers three cases: items saved before reminders repeated (they
// only have a one-time notification), reminders the phone lost (an app reinstall
// clears them), and any that failed to schedule earlier. Cheap when nothing needs
// fixing - one look at what's scheduled - and best-effort throughout: it never
// throws, and does nothing without notification permission rather than prompting.
export async function ensureRecurringReminders(rows: TaskRow[]): Promise<TaskRow[]> {
  const candidates = rows.filter((t) => t.recurring_frequency && t.datetime && !t.is_completed);
  if (candidates.length === 0) return rows;

  try {
    if (!(await hasNotificationPermission())) return rows;

    const scheduled = await getScheduledRecurringMarkers();
    const updates = new Map<string, TaskRow>();
    for (const task of candidates) {
      const marker = recurringMarker(task.id);
      if (task.datetime_notification_id === marker && scheduled.has(marker)) continue;
      updates.set(task.id, await syncDueNotification(task));
    }
    return rows.map((t) => updates.get(t.id) ?? t);
  } catch {
    return rows;
  }
}

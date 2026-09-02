import * as Notifications from "expo-notifications";
import type { TaskRow } from "../types/task";

async function ensureNotificationPermission(): Promise<boolean> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  if (existingStatus === "granted") return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

// Schedules the "time to leave" local notification and returns its id (so it can
// be cancelled/rescheduled later), or null if permission was denied or leavingBy
// has already passed - in either case there's nothing to schedule.
export async function scheduleLeavingNotification(
  task: TaskRow,
  leavingBy: Date
): Promise<string | null> {
  if (leavingBy.getTime() <= Date.now()) return null;

  const granted = await ensureNotificationPermission();
  if (!granted) return null;

  const body =
    task.location_raw_text && task.travel_duration_minutes != null
      ? `${task.location_raw_text} - about ${task.travel_duration_minutes} min away`
      : (task.location_raw_text ?? undefined);

  return Notifications.scheduleNotificationAsync({
    content: {
      title: `Time to leave for ${task.title}`,
      body,
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: leavingBy },
  });
}

// Schedules a notification firing at the task/event's own datetime (e.g. "pick
// up dry cleaning" going off at 10am) - independent of scheduleLeavingNotification
// above, which is location-based and fires *before* the event to account for
// travel time. This one fires *at* the time itself and needs no location at
// all. Returns null (nothing scheduled) if there's no datetime, permission was
// denied, or the time has already passed.
export async function scheduleDueNotification(task: TaskRow): Promise<string | null> {
  if (!task.datetime) return null;
  const dueDate = new Date(task.datetime);
  if (Number.isNaN(dueDate.getTime()) || dueDate.getTime() <= Date.now()) return null;

  const granted = await ensureNotificationPermission();
  if (!granted) return null;

  return Notifications.scheduleNotificationAsync({
    content: {
      title: task.title,
      body: task.location_raw_text ?? undefined,
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: dueDate },
  });
}

// Never leaves an orphaned notification behind - safe to call with an id that's
// already fired or already cancelled.
export async function cancelNotification(notificationId: string | null): Promise<void> {
  if (!notificationId) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch {
    // Already gone - nothing to do.
  }
}

import * as Notifications from "expo-notifications";
import type { TaskRow } from "../types/task";
import { notesPreview } from "./notes";
import { planRepeatingTriggers, type RepeatingTrigger } from "./recurringTriggers";

// A recurring item's repeating reminder is stored on the task as this marker
// (`recurring:<task id>`) instead of a notification id. It can be several
// notifications under the hood (one per weekday for "Mon & Thu", twelve for "the
// 31st"), named `<marker>:<n>`, and cancelling the marker cancels them all - so
// every existing place that cancels a task's reminder works unchanged.
const RECURRING_PREFIX = "recurring:";

export function recurringMarker(taskId: string): string {
  return `${RECURRING_PREFIX}${taskId}`;
}

function isRecurringMarker(id: string): boolean {
  return id.startsWith(RECURRING_PREFIX);
}

// A notification body from its lines (where to go, the notes preview), leaving
// out the empty ones; undefined when there's nothing to say.
function reminderBody(task: TaskRow, firstLine: string | null): string | undefined {
  const preview = notesPreview(task.notes);
  const lines = [firstLine, preview ? `Notes: ${preview}` : null].filter((line): line is string => Boolean(line));
  return lines.length > 0 ? lines.join("\n") : undefined;
}

// Without prompting - for background checks that shouldn't pop a dialog.
export async function hasNotificationPermission(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === "granted";
}

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

  const where =
    task.location_raw_text && task.travel_duration_minutes != null
      ? `${task.location_raw_text} - about ${task.travel_duration_minutes} min away`
      : task.location_raw_text;

  return Notifications.scheduleNotificationAsync({
    content: {
      title: `Time to leave for ${task.title}`,
      body: reminderBody(task, where),
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

  // A repeating item gets a notification that repeats on its own schedule, so it
  // keeps firing whether or not the user completes it or opens the app. If that
  // can't be set up (permission denied, or a platform without repeating
  // triggers) it falls through to the one-time reminder for this occurrence.
  if (task.recurring_frequency) {
    const marker = await scheduleRecurringDueNotification(task);
    if (marker) return marker;
  }

  const dueDate = new Date(task.datetime);
  if (Number.isNaN(dueDate.getTime()) || dueDate.getTime() <= Date.now()) return null;

  const granted = await ensureNotificationPermission();
  if (!granted) return null;

  return Notifications.scheduleNotificationAsync({
    content: {
      title: task.title,
      body: reminderBody(task, task.location_raw_text),
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: dueDate },
  });
}

function toTriggerInput(trigger: RepeatingTrigger): Notifications.NotificationTriggerInput {
  const { SchedulableTriggerInputTypes: Types } = Notifications;
  switch (trigger.kind) {
    case "daily":
      return { type: Types.DAILY, hour: trigger.hour, minute: trigger.minute };
    case "weekly":
      return { type: Types.WEEKLY, weekday: trigger.weekday, hour: trigger.hour, minute: trigger.minute };
    case "monthly":
      return { type: Types.MONTHLY, day: trigger.day, hour: trigger.hour, minute: trigger.minute };
    case "yearly":
      return { type: Types.YEARLY, month: trigger.month, day: trigger.day, hour: trigger.hour, minute: trigger.minute };
  }
}

// Schedules the repeating "at the time" reminder for a recurring item, at the
// time of day of its current occurrence. Returns the marker to store on the task,
// or null if nothing could be scheduled (nothing is left half-scheduled).
async function scheduleRecurringDueNotification(task: TaskRow): Promise<string | null> {
  if (!task.recurring_frequency || !task.datetime) return null;
  const anchor = new Date(task.datetime);
  if (Number.isNaN(anchor.getTime())) return null;

  const granted = await ensureNotificationPermission();
  if (!granted) return null;

  const marker = recurringMarker(task.id);
  const triggers = planRepeatingTriggers(task.recurring_frequency, task.recurring_detail, anchor);

  try {
    await Promise.all(
      triggers.map((trigger, index) =>
        Notifications.scheduleNotificationAsync({
          identifier: `${marker}:${index}`,
          content: { title: task.title, body: reminderBody(task, task.location_raw_text) },
          trigger: toTriggerInput(trigger),
        })
      )
    );
    return marker;
  } catch (err) {
    console.error("scheduleRecurringDueNotification: failed to schedule", err);
    await cancelNotification(marker);
    return null;
  }
}

// The recurring markers that currently have notifications scheduled on this
// device - how the app notices reminders the phone has lost (e.g. after a
// reinstall) or that were never upgraded to repeating.
export async function getScheduledRecurringMarkers(): Promise<Set<string>> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const markers = new Set<string>();
  for (const request of scheduled) {
    if (!isRecurringMarker(request.identifier)) continue;
    markers.add(request.identifier.slice(0, request.identifier.lastIndexOf(":")));
  }
  return markers;
}

// Never leaves an orphaned notification behind - safe to call with an id that's
// already fired or already cancelled. Given a recurring marker it cancels every
// notification that belongs to it.
export async function cancelNotification(notificationId: string | null): Promise<void> {
  if (!notificationId) return;
  try {
    if (isRecurringMarker(notificationId)) {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      await Promise.all(
        scheduled
          .filter((request) => request.identifier.startsWith(`${notificationId}:`))
          .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier))
      );
      return;
    }
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch {
    // Already gone - nothing to do.
  }
}

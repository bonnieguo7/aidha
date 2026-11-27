import * as Notifications from "expo-notifications";
import { planHabitReminders, reminderBody } from "./habits";
import { fetchHabitCheckins, fetchHabits } from "./habitsApi";
import { hasNotificationPermission } from "./notifications";
import type { HabitCheckin, HabitRow } from "../types/habit";

// Habit reminders are one-off notifications planned a week ahead and re-planned
// whenever habits or check-ins change (and each time Today loads), so a
// reminder never fires for a habit that's already done for the period. Each is
// named `habit:<habit id>:<time>`, so they can all be found and replaced at once.
const PREFIX = "habit:";
const HORIZON_DAYS = 7;
// iOS keeps at most 64 pending notifications for the whole app; leave most of
// them for task reminders.
const MAX_SCHEDULED = 24;

let queue: Promise<void> = Promise.resolve();

// Replaces every scheduled habit reminder with a fresh plan. Calls run one
// after another, so two quick check-ins can't interleave and leave duplicates.
// Best-effort: never throws, and never prompts for permission (the habit editor
// asks when a reminder is set).
export function syncHabitReminders(habits: HabitRow[], checkins: HabitCheckin[]): Promise<void> {
  queue = queue.then(() => replaceHabitReminders(habits, checkins)).catch(() => {});
  return queue;
}

async function replaceHabitReminders(habits: HabitRow[], checkins: HabitCheckin[]): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((request) => request.identifier.startsWith(PREFIX))
      .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier))
  );

  const withReminders = habits.filter((h) => h.reminder_time && !h.archived_at);
  if (withReminders.length === 0 || !(await hasNotificationPermission())) return;

  const now = new Date();
  const planned = withReminders
    .flatMap((habit) => {
      const times = checkins.filter((c) => c.habit_id === habit.id).map((c) => c.completed_at);
      return planHabitReminders(habit, times, now, HORIZON_DAYS).map((reminder) => ({ habit, reminder }));
    })
    .sort((a, b) => a.reminder.date.getTime() - b.reminder.date.getTime())
    .slice(0, MAX_SCHEDULED);

  await Promise.all(
    planned.map(({ habit, reminder }) =>
      Notifications.scheduleNotificationAsync({
        identifier: `${PREFIX}${habit.id}:${reminder.date.getTime()}`,
        content: { title: habit.title, body: reminderBody(habit.cadence, reminder), data: { habitId: habit.id } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminder.date },
      })
    )
  );
}

// Loads the user's habits and recent check-ins and re-plans all habit
// reminders - for screens that changed a habit without holding the full list.
export async function refreshHabitReminders(): Promise<void> {
  const now = new Date();
  // Far enough back to cover the current week and month.
  const since = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [habits, checkins] = await Promise.all([fetchHabits(), fetchHabitCheckins(since)]);
  if (habits.data && checkins) await syncHabitReminders(habits.data, checkins);
}

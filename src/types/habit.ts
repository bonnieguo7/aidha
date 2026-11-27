// A habit is something the user wants to do at some cadence - "clean my room
// every day", "clean the bathroom once a week", "gym 3× a week" - on any day
// within the period, as opposed to a repeating task pinned to a date.
export type HabitCadence = "daily" | "weekly" | "monthly";

export interface HabitRow {
  id: string;
  user_id: string;
  title: string;
  cadence: HabitCadence;
  // How many check-ins meet the goal for one period.
  target_count: number;
  // Local "HH:MM", or null for no reminder.
  reminder_time: string | null;
  notes: string | null;
  // Set when the user deletes it: it disappears, but its check-ins stay in the
  // Profile counts.
  archived_at: string | null;
  created_at: string;
}

export interface HabitCheckin {
  id: string;
  habit_id: string;
  completed_at: string;
}

// A habit before it's saved - from the AI or the manual form.
export interface HabitDraft {
  title: string;
  cadence: HabitCadence;
  target_count: number;
  reminder_time: string | null;
  notes: string | null;
}

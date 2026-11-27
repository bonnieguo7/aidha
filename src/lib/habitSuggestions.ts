import type { HabitDraft } from "../types/habit";

export interface HabitSuggestion {
  emoji: string;
  draft: HabitDraft;
}

export interface HabitSuggestionGroup {
  title: string;
  habits: HabitSuggestion[];
}

const daily = (title: string): HabitDraft => ({ title, cadence: "daily", target_count: 1, reminder_time: null, notes: null });
const weekly = (title: string, target_count: number): HabitDraft => ({
  title,
  cadence: "weekly",
  target_count,
  reminder_time: null,
  notes: null,
});

// Common habits offered on the New Habit page. Picking one fills in the form,
// so the user can still change anything before saving.
export const HABIT_SUGGESTIONS: HabitSuggestionGroup[] = [
  {
    title: "Health",
    habits: [
      { emoji: "😴", draft: daily("Sleep 8 hours") },
      { emoji: "💧", draft: daily("Drink 8 glasses of water") },
      { emoji: "🏃", draft: daily("Exercise for 30 minutes") },
      { emoji: "🚶", draft: daily("Walk 10,000 steps") },
      { emoji: "🥦", draft: daily("Eat fruits and vegetables") },
      { emoji: "🏋️", draft: weekly("Strength training", 3) },
    ],
  },
  {
    title: "Mind",
    habits: [
      { emoji: "🧘", draft: daily("Meditate for 10 minutes") },
      { emoji: "📚", draft: daily("Read for 20 minutes") },
      { emoji: "✍️", draft: daily("Journal") },
      { emoji: "📵", draft: daily("No screens an hour before bed") },
    ],
  },
  {
    title: "Home & people",
    habits: [
      { emoji: "🧹", draft: daily("Tidy up for 10 minutes") },
      { emoji: "🛁", draft: weekly("Clean the bathroom", 1) },
      { emoji: "📞", draft: weekly("Call family or a friend", 1) },
    ],
  },
];

// Whether the user already has a habit with this name (ignoring case and
// spacing), so the suggestion can show as added.
export function hasHabitTitled(existingTitles: string[], title: string): boolean {
  const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  return existingTitles.some((t) => key(t) === key(title));
}

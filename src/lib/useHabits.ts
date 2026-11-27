import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useMemo, useRef, useState } from "react";
import { useAccomplishments } from "./AccomplishmentsContext";
import { syncHabitReminders } from "./habitReminders";
import { habitProgress, latestCheckinThisPeriod, type HabitProgress } from "./habits";
import { addCheckin, fetchHabitCheckins, fetchHabits, removeCheckin } from "./habitsApi";
import type { HabitCheckin, HabitRow } from "../types/habit";

export interface HabitStatus {
  habit: HabitRow;
  progress: HabitProgress;
}

// How far back check-ins are loaded - enough for streaks of up to a year.
function lookbackStart(now: Date): Date {
  return new Date(now.getFullYear() - 1, now.getMonth(), 1);
}

export function statusesFor(habits: HabitRow[], checkins: HabitCheckin[], now: Date): HabitStatus[] {
  const since = lookbackStart(now);
  const byHabit = new Map<string, string[]>();
  for (const c of checkins) {
    const list = byHabit.get(c.habit_id) ?? [];
    list.push(c.completed_at);
    byHabit.set(c.habit_id, list);
  }
  return habits.map((habit) => ({
    habit,
    progress: habitProgress(habit, byHabit.get(habit.id) ?? [], now, since),
  }));
}

// The user's habits with this period's progress and streaks. Reloads whenever
// the screen using it comes into focus, and re-plans habit reminders after each
// load and check-in so they match what's left to do.
export function useHabits() {
  const { recordCheckin, recordCheckinRemoved } = useAccomplishments();
  const [habits, setHabits] = useState<HabitRow[]>([]);
  const [checkins, setCheckins] = useState<HabitCheckin[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Habit ids with a check-in being saved, so a double tap can't add two.
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const loadId = useRef(0);

  const reload = useCallback(async () => {
    const id = ++loadId.current;
    const [habitsResult, checkinRows] = await Promise.all([fetchHabits(), fetchHabitCheckins(lookbackStart(new Date()))]);
    if (id !== loadId.current) return;
    setIsLoading(false);
    if (habitsResult.error || !habitsResult.data || !checkinRows) {
      setError(habitsResult.error ?? "Couldn't load your habits.");
      return;
    }
    setError(null);
    setHabits(habitsResult.data);
    setCheckins(checkinRows);
    syncHabitReminders(habitsResult.data, checkinRows);
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const statuses = useMemo(() => statusesFor(habits, checkins, new Date()), [habits, checkins]);

  const setBusy = useCallback((id: string, busy: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const checkIn = useCallback(
    async (habit: HabitRow): Promise<string | null> => {
      if (busyIds.has(habit.id)) return null;
      setBusy(habit.id, true);
      const { data, error: insertError } = await addCheckin(habit.id);
      setBusy(habit.id, false);
      if (insertError || !data) return insertError ?? "Couldn't save the check-in.";

      // A reload started before this check-in would come back without it.
      loadId.current += 1;
      const nextCheckins = [...checkins, data];
      setCheckins(nextCheckins);
      const [status] = statusesFor([habit], nextCheckins, new Date());
      recordCheckin(habit.cadence, status.progress);
      syncHabitReminders(habits, nextCheckins);
      return null;
    },
    [busyIds, checkins, habits, recordCheckin, setBusy]
  );

  // Takes back the most recent check-in of the current period - for a
  // mis-tap. Does nothing if there's none this period.
  const uncheck = useCallback(
    async (habit: HabitRow): Promise<string | null> => {
      if (busyIds.has(habit.id)) return null;
      const latest = latestCheckinThisPeriod(
        habit.cadence,
        checkins.filter((c) => c.habit_id === habit.id),
        new Date()
      );
      if (!latest) return null;
      setBusy(habit.id, true);
      const removeError = await removeCheckin(latest.id);
      setBusy(habit.id, false);
      if (removeError) return removeError;

      loadId.current += 1;
      const nextCheckins = checkins.filter((c) => c.id !== latest.id);
      setCheckins(nextCheckins);
      recordCheckinRemoved();
      syncHabitReminders(habits, nextCheckins);
      return null;
    },
    [busyIds, checkins, habits, recordCheckinRemoved, setBusy]
  );

  return { statuses, isLoading, error, reload, checkIn, uncheck, busyIds };
}

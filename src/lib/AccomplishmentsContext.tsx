import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import CelebrationToast, { type Celebration } from "../components/CelebrationToast";
import { completionMessage, countToday } from "./accomplishments";
import { streakLabel, type HabitProgress } from "./habits";
import { useAuth } from "./AuthContext";
import { fetchCompletionTimes } from "./fetchAccomplishments";
import type { HabitCadence } from "../types/habit";
import type { TaskRow } from "../types/task";

interface AccomplishmentsValue {
  // Re-reads today's count (e.g. when Today regains focus).
  refresh: () => Promise<void>;
  // Call right after a task is actually completed (see CompleteTaskResult.completed):
  // shows the "N done today" toast.
  recordCompletion: (task: TaskRow) => void;
  // Call after a task is restored from the Archive.
  recordUncompletion: (task: TaskRow) => void;
  // Call right after a habit check-in is saved, with the habit's progress
  // including it: counts toward today and shows the toast (with the streak once
  // the goal is met).
  recordCheckin: (cadence: HabitCadence, progress: HabitProgress) => void;
  // Call after a habit check-in is removed.
  recordCheckinRemoved: () => void;
}

const AccomplishmentsContext = createContext<AccomplishmentsValue | undefined>(undefined);

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// Keeps today's count of completed tasks and habit check-ins so ticking
// something off can show a quick "3 done today" toast. The weekly and monthly totals live on the Profile screen,
// which loads its own numbers.
export function AccomplishmentsProvider({ children }: { children: ReactNode }) {
  // Keyed on the user id, not the session object, so the count reloads when the
  // user changes rather than whenever the session object is recreated.
  const userId = useAuth().session?.user.id ?? null;
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  // Null until loaded. A ref, not state - nothing renders it directly.
  const todayCount = useRef<number | null>(null);
  // The day `todayCount` belongs to, so a count from yesterday isn't carried
  // past midnight.
  const countDay = useRef(startOfToday().getTime());
  const celebrationId = useRef(0);
  // Bumped on every local completion. A reload that started before one must not
  // land afterwards and overwrite the count it just added - its number is older.
  const completionGeneration = useRef(0);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const generation = completionGeneration.current;
    const day = startOfToday();
    const times = await fetchCompletionTimes(day);
    if (!times || generation !== completionGeneration.current) return;
    todayCount.current = countToday(times, new Date());
    countDay.current = day.getTime();
  }, [userId]);

  useEffect(() => {
    todayCount.current = null;
    refresh();
  }, [refresh]);

  // Adds one to today's count and returns the new count.
  const countOne = useCallback(() => {
    completionGeneration.current += 1;
    const today = startOfToday().getTime();
    const before = countDay.current === today ? todayCount.current ?? 0 : 0;
    todayCount.current = before + 1;
    countDay.current = today;
    return todayCount.current;
  }, []);

  const celebrate = useCallback((title: string) => {
    celebrationId.current += 1;
    setCelebration({ id: celebrationId.current, title });
  }, []);

  const recordCompletion = useCallback(
    (task: TaskRow) => {
      // Only tasks count - an event can't be "done" in a way the app can verify.
      if (task.type !== "task") return;
      celebrate(completionMessage(countOne()));
    },
    [countOne, celebrate]
  );

  const recordCheckin = useCallback(
    (cadence: HabitCadence, progress: HabitProgress) => {
      const count = countOne();
      celebrate(
        progress.met && progress.streak >= 2
          ? `🔥 ${streakLabel(cadence, progress.streak)} in a row!`
          : completionMessage(count)
      );
    },
    [countOne, celebrate]
  );

  const recordUncompletion = useCallback(
    (task: TaskRow) => {
      if (task.type !== "task") return;
      // It may have been completed on another day, so recount rather than guess.
      refresh();
    },
    [refresh]
  );

  const recordCheckinRemoved = useCallback(() => {
    refresh();
  }, [refresh]);

  return (
    <AccomplishmentsContext.Provider
      value={{ refresh, recordCompletion, recordUncompletion, recordCheckin, recordCheckinRemoved }}
    >
      <View style={{ flex: 1 }}>
        {children}
        <CelebrationToast celebration={celebration} onDone={() => setCelebration(null)} />
      </View>
    </AccomplishmentsContext.Provider>
  );
}

export function useAccomplishments() {
  const ctx = useContext(AccomplishmentsContext);
  if (!ctx) throw new Error("useAccomplishments must be used within AccomplishmentsProvider");
  return ctx;
}

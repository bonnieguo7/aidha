import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { getDayBounds } from "../lib/dayLayout";
import { supabase } from "../lib/supabase";
import { colors } from "../lib/theme";
import type { TaskRow } from "../types/task";
import DayTimeline from "./DayTimeline";

function startOfToday(): Date {
  return getDayBounds(new Date()).start;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

function dayTitle(date: Date, today: Date): string {
  const diffDays = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "long" });
}

function summarize(tasks: TaskRow[]): string {
  const events = tasks.filter((t) => t.type === "event").length;
  const timedTasks = tasks.length - events;
  const parts = [
    events > 0 ? `${events} ${events === 1 ? "event" : "events"}` : null,
    timedTasks > 0 ? `${timedTasks} ${timedTasks === 1 ? "task" : "tasks"}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Nothing scheduled";
}

export default function DayView({ onOpenTask }: { onOpenTask: (task: TaskRow) => void }) {
  const [date, setDate] = useState(startOfToday);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tapping through days quickly fires overlapping requests; only the latest
  // one's result may land, or a slow earlier day could overwrite a later one.
  const latestRequest = useRef(0);

  const load = useCallback(async (day: Date) => {
    const requestId = ++latestRequest.current;
    const { start, end } = getDayBounds(day);

    // Unlike the Today list (open items only), this includes completed ones:
    // an event that has already passed is auto-archived, but it still belongs
    // on the day it happened. Flexible "whenever" tasks are left out - their
    // date is just a nudge, not a time to be somewhere.
    const { data, error: fetchError } = await supabase
      .from("tasks")
      .select("*")
      .gte("datetime", start.toISOString())
      .lt("datetime", end.toISOString())
      .eq("requires_downtime", false)
      .order("datetime", { ascending: true });

    if (requestId !== latestRequest.current) return;

    if (fetchError) {
      setError(fetchError.message);
    } else {
      setError(null);
      setTasks((data ?? []) as TaskRow[]);
    }
    setIsLoaded(true);
  }, []);

  // Reloads whenever the day changes or the screen regains focus (e.g. back
  // from editing a task) - silently, so coming back doesn't flash a spinner or
  // reset the grid's scroll position. Only switching days shows the spinner.
  useFocusEffect(
    useCallback(() => {
      load(date);
    }, [date, load])
  );

  async function handleRefresh() {
    setIsRefreshing(true);
    await load(date);
    setIsRefreshing(false);
  }

  function goToDay(next: Date) {
    setIsLoaded(false);
    setDate(next);
  }

  function shiftDay(delta: number) {
    goToDay(new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta));
  }

  const today = startOfToday();
  const isToday = isSameDay(date, today);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable onPress={() => shiftDay(-1)} hitSlop={10} accessibilityLabel="Previous day">
            <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.headerCenter}>
          <Text style={styles.dateLabel}>
            {date.toLocaleDateString(undefined, { month: "long", day: "numeric" }).toUpperCase()}
          </Text>
          <Text style={styles.title}>{dayTitle(date, today)}</Text>
          <Text style={styles.summary}>{isLoaded ? summarize(tasks) : " "}</Text>
        </View>

        <View style={styles.headerRight}>
          {!isToday && (
            <Pressable onPress={() => goToDay(startOfToday())} style={styles.todayPill} hitSlop={6}>
              <Text style={styles.todayPillText}>Today</Text>
            </Pressable>
          )}
          <Pressable onPress={() => shiftDay(1)} hitSlop={10} accessibilityLabel="Next day">
            <Ionicons name="chevron-forward" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {isLoaded ? (
        <DayTimeline
          date={date}
          tasks={tasks}
          isLoaded={isLoaded}
          isRefreshing={isRefreshing}
          onRefresh={handleRefresh}
          onOpenTask={onOpenTask}
        />
      ) : (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 10,
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  // Equal fixed widths on both sides keep the title centered whether or not
  // the "Today" pill is showing.
  headerLeft: {
    width: 76,
    alignItems: "flex-start",
  },
  headerRight: {
    width: 76,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
  },
  dateLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.8,
    color: colors.textSecondary,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  summary: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  todayPill: {
    backgroundColor: colors.accentSoft,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  todayPillText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "600",
  },
  error: {
    color: colors.danger,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});

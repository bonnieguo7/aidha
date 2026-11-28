import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { checkinsByDay, dayKey, monthGrid } from "../lib/habits";
import { colors } from "../lib/theme";
import type { HabitCadence, HabitCheckin } from "../types/habit";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

// A month of a habit's check-ins: a filled day was checked off. Past days and
// today can be tapped to check them off or undo them (onDayPress decides);
// future days can't. Months step back as far as `earliest`.
export default function HabitCalendar({
  checkins,
  cadence,
  target,
  earliest,
  busyDay,
  onDayPress,
}: {
  checkins: HabitCheckin[];
  cadence: HabitCadence;
  target: number;
  earliest: Date;
  // dayKey of a day whose change is being saved.
  busyDay: string | null;
  onDayPress: (day: Date, dayCheckins: HabitCheckin[]) => void;
}) {
  const now = new Date();
  const todayKey = dayKey(now);
  const [month, setMonth] = useState(() => startOfMonth(now));
  const byDay = useMemo(() => checkinsByDay(checkins), [checkins]);
  const weeks = useMemo(() => monthGrid(month), [month]);

  const canGoBack = month.getTime() > startOfMonth(earliest).getTime();
  const canGoForward = month.getTime() < startOfMonth(now).getTime();
  // A day counts as fully done when it alone meets a daily goal; for weekly
  // and monthly habits any check-in fills the day.
  const fullCount = cadence === "daily" ? target : 1;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Pressable
          onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          disabled={!canGoBack}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
        >
          <Ionicons name="chevron-back" size={20} color={canGoBack ? colors.accent : colors.border} />
        </Pressable>
        <Text style={styles.monthLabel}>
          {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </Text>
        <Pressable
          onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          disabled={!canGoForward}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Next month"
        >
          <Ionicons name="chevron-forward" size={20} color={canGoForward ? colors.accent : colors.border} />
        </Pressable>
      </View>

      <View style={styles.week}>
        {WEEKDAYS.map((d, i) => (
          <Text key={i} style={styles.weekday}>
            {d}
          </Text>
        ))}
      </View>

      {weeks.map((week, w) => (
        <View key={w} style={styles.week}>
          {week.map((day, i) => {
            if (!day) return <View key={i} style={styles.cell} />;
            const key = dayKey(day);
            const dayCheckins = byDay.get(key) ?? [];
            const count = dayCheckins.length;
            const isFuture = key > todayKey;
            const isToday = key === todayKey;
            const full = count >= fullCount;
            const partial = count > 0 && !full;
            const label = day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
            return (
              <Pressable
                key={i}
                style={styles.cell}
                onPress={() => onDayPress(day, dayCheckins)}
                disabled={isFuture || busyDay !== null}
                accessibilityRole="button"
                accessibilityLabel={`${label}: ${count === 0 ? "not done" : count === 1 ? "checked off" : `checked off ${count} times`}`}
                accessibilityState={{ disabled: isFuture }}
              >
                <View
                  style={[
                    styles.dayCircle,
                    full && styles.dayFull,
                    partial && styles.dayPartial,
                    isToday && !full && styles.dayToday,
                  ]}
                >
                  {busyDay === key ? (
                    <ActivityIndicator size="small" color={full ? colors.onSurfaceInverse : colors.success} />
                  ) : (
                    <Text
                      style={[
                        styles.dayText,
                        isFuture && styles.dayTextFuture,
                        full && styles.dayTextFull,
                        isToday && !full && styles.dayTextToday,
                      ]}
                    >
                      {day.getDate()}
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}

      <Text style={styles.hint}>Tap a day to check it off, or tap a checked day to undo it.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  monthLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  week: {
    flexDirection: "row",
  },
  weekday: {
    flex: 1,
    textAlign: "center",
    fontSize: 11,
    fontWeight: "600",
    color: colors.textMuted,
    paddingVertical: 4,
  },
  cell: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 3,
  },
  dayCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  dayFull: {
    backgroundColor: colors.success,
  },
  dayPartial: {
    backgroundColor: colors.successSoft,
  },
  dayToday: {
    borderWidth: 1.5,
    borderColor: colors.success,
  },
  dayText: {
    fontSize: 14,
    color: colors.textPrimary,
    fontVariant: ["tabular-nums"],
  },
  dayTextFuture: {
    color: colors.textMuted,
  },
  dayTextFull: {
    color: colors.onSurfaceInverse,
    fontWeight: "700",
  },
  dayTextToday: {
    color: colors.success,
    fontWeight: "700",
  },
  hint: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: "center",
    marginTop: 8,
  },
});

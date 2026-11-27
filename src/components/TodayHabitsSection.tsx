import { StyleSheet, Text, View } from "react-native";
import HabitRowItem from "./HabitRowItem";
import { colors } from "../lib/theme";
import type { HabitStatus } from "../lib/useHabits";
import type { HabitRow } from "../types/habit";

// Today's "Habits" section: every habit, checkable in place - the ones still to
// do this period first, then the ones already done (still shown, so a mis-tap
// can be unchecked right there). Renders nothing if the user has no habits.
export default function TodayHabitsSection({
  statuses,
  busyIds,
  onCheckIn,
  onUncheck,
  onOpen,
}: {
  statuses: HabitStatus[];
  busyIds: Set<string>;
  onCheckIn: (habit: HabitRow) => void;
  onUncheck: (habit: HabitRow) => void;
  onOpen: (habit: HabitRow) => void;
}) {
  if (statuses.length === 0) return null;
  const pending = statuses.filter((s) => !s.progress.met);
  const done = statuses.filter((s) => s.progress.met);
  const doneCount = done.length;

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <View style={styles.dot} />
        <Text style={styles.label}>Habits</Text>
        {doneCount > 0 && (
          <Text style={styles.count}>
            {doneCount} of {statuses.length} done
          </Text>
        )}
      </View>
      {[...pending, ...done].map((status) => (
        <HabitRowItem
          key={status.habit.id}
          status={status}
          busy={busyIds.has(status.habit.id)}
          onCheckIn={() => onCheckIn(status.habit)}
          onUncheck={() => onUncheck(status.habit)}
          onPress={() => onOpen(status.habit)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 20,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.success,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: colors.success,
  },
  count: {
    marginLeft: "auto",
    fontSize: 12,
    color: colors.textSecondary,
  },
});

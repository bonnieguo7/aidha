import { StyleSheet, Text, View } from "react-native";
import HabitRowItem from "./HabitRowItem";
import { colors } from "../lib/theme";
import type { HabitStatus } from "../lib/useHabits";
import type { HabitRow } from "../types/habit";

// Today's "Habits" section: the habits still to do this period, checkable in
// place. Ones already met for the period drop out; when they all have, a single
// line says so. Renders nothing if the user has no habits.
export default function TodayHabitsSection({
  statuses,
  busyIds,
  onCheckIn,
  onOpen,
}: {
  statuses: HabitStatus[];
  busyIds: Set<string>;
  onCheckIn: (habit: HabitRow) => void;
  onOpen: (habit: HabitRow) => void;
}) {
  if (statuses.length === 0) return null;
  const pending = statuses.filter((s) => !s.progress.met);
  const doneCount = statuses.length - pending.length;

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
      {pending.length === 0 ? (
        <Text style={styles.allDone}>All habits done for now ✓</Text>
      ) : (
        pending.map((status) => (
          <HabitRowItem
            key={status.habit.id}
            status={status}
            busy={busyIds.has(status.habit.id)}
            onCheckIn={() => onCheckIn(status.habit)}
            onPress={() => onOpen(status.habit)}
          />
        ))
      )}
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
  allDone: {
    fontSize: 14,
    color: colors.textSecondary,
    paddingVertical: 4,
  },
});

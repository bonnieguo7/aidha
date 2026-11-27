import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { cadenceLabel, progressLabel, streakLabel } from "../lib/habits";
import { colors } from "../lib/theme";
import type { HabitStatus } from "../lib/useHabits";

// One habit: a check-in button, its name, this period's progress and its
// streak. The button works like a checkbox: tapping a done habit unchecks it
// (takes back this period's latest check-in), and on a habit that's partway
// there ("1 of 3") a long press takes one back. Tapping the row (not the
// button) opens the habit.
export default function HabitRowItem({
  status,
  busy,
  onCheckIn,
  onUncheck,
  onPress,
}: {
  status: HabitStatus;
  busy: boolean;
  onCheckIn: () => void;
  onUncheck: () => void;
  onPress: () => void;
}) {
  const { habit, progress } = status;
  const canUndo = progress.done > 0;
  const details = [
    progress.target > 1 || progress.met ? progressLabel(habit.cadence, progress) : cadenceLabel(habit.cadence, 1),
    progress.streak > 0 ? `🔥 ${streakLabel(habit.cadence, progress.streak)}` : null,
  ].filter(Boolean);

  return (
    <View style={styles.row}>
      <Pressable
        onPress={progress.met ? onUncheck : onCheckIn}
        onLongPress={canUndo && !progress.met ? onUncheck : undefined}
        disabled={busy}
        hitSlop={8}
        style={[styles.check, progress.met && styles.checkDone]}
        accessibilityRole="checkbox"
        accessibilityLabel={habit.title}
        accessibilityHint={progress.met ? "Unchecks it" : "Checks in"}
        accessibilityState={{ disabled: busy, checked: progress.met ? true : canUndo ? "mixed" : false }}
        accessibilityActions={canUndo && !progress.met ? [{ name: "undo", label: "Undo last check-in" }] : undefined}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "undo") onUncheck();
        }}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.success} />
        ) : (
          <Ionicons
            name={progress.met ? "checkmark" : "add"}
            size={18}
            color={progress.met ? colors.onSurfaceInverse : colors.success}
          />
        )}
      </Pressable>
      <Pressable style={({ pressed }) => [styles.body, pressed && styles.pressed]} onPress={onPress}>
        <Text style={[styles.title, progress.met && styles.titleDone]} numberOfLines={2}>
          {habit.title}
        </Text>
        <Text style={styles.details} numberOfLines={1}>
          {details.join(" · ")}
        </Text>
      </Pressable>
      {progress.target > 1 && (
        <View style={styles.dots} importantForAccessibility="no" accessibilityElementsHidden>
          {Array.from({ length: Math.min(progress.target, 7) }, (_, i) => (
            <View key={i} style={[styles.dot, i < progress.done && styles.dotDone]} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  check: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: colors.success,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  checkDone: {
    backgroundColor: colors.success,
  },
  body: {
    flex: 1,
  },
  pressed: {
    opacity: 0.6,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  titleDone: {
    color: colors.textSecondary,
  },
  details: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  dots: {
    flexDirection: "row",
    gap: 4,
    marginLeft: 10,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.successSoft,
  },
  dotDone: {
    backgroundColor: colors.success,
  },
});

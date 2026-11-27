import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import HabitRowItem from "./HabitRowItem";
import { colors } from "../lib/theme";
import { useHabits } from "../lib/useHabits";
import type { HabitRow } from "../types/habit";

// The Habits tab's list: every habit, done-for-now ones included, with progress
// and streaks, under a button for starting a new one.
export default function HabitList({
  onSelectHabit,
  onNewHabit,
}: {
  onSelectHabit: (habit: HabitRow) => void;
  onNewHabit: () => void;
}) {
  const { statuses, isLoading, error, reload, checkIn, uncheck, busyIds } = useHabits();
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function handleRefresh() {
    setIsRefreshing(true);
    await reload();
    setIsRefreshing(false);
  }

  async function handleCheckIn(habit: HabitRow) {
    const checkInError = await checkIn(habit);
    if (checkInError) Alert.alert("Couldn't check in", checkInError);
  }

  async function handleUncheck(habit: HabitRow) {
    const uncheckError = await uncheck(habit);
    if (uncheckError) Alert.alert("Couldn't uncheck it", uncheckError);
  }

  const doneCount = statuses.filter((s) => s.progress.met).length;

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.content}
      data={statuses}
      keyExtractor={(s) => s.habit.id}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.accent} />}
      ListHeaderComponent={
        <>
          {error && <Text style={styles.error}>{error}</Text>}
          {statuses.length > 0 && (
            <View style={styles.headerRow}>
              <Text style={styles.summary}>
                {doneCount} of {statuses.length} done for now
              </Text>
              <Pressable onPress={onNewHabit} style={styles.newButton} hitSlop={6} accessibilityRole="button">
                <Ionicons name="add" size={16} color={colors.onSurfaceInverse} />
                <Text style={styles.newButtonText}>New habit</Text>
              </Pressable>
            </View>
          )}
        </>
      }
      ListEmptyComponent={
        error ? null : (
          <View style={styles.empty}>
            <Ionicons name="flame-outline" size={28} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No habits yet</Text>
            <Text style={styles.emptyText}>
              Pick from popular ones like sleep, water and exercise, or make your own.
            </Text>
            <Pressable onPress={onNewHabit} style={[styles.newButton, styles.emptyButton]} accessibilityRole="button">
              <Ionicons name="add" size={16} color={colors.onSurfaceInverse} />
              <Text style={styles.newButtonText}>Start a habit</Text>
            </Pressable>
          </View>
        )
      }
      renderItem={({ item }) => (
        <HabitRowItem
          status={item}
          busy={busyIds.has(item.habit.id)}
          onCheckIn={() => handleCheckIn(item.habit)}
          onUncheck={() => handleUncheck(item.habit)}
          onPress={() => onSelectHabit(item.habit)}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  summary: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  newButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  newButtonText: {
    color: colors.onSurfaceInverse,
    fontSize: 14,
    fontWeight: "700",
  },
  emptyButton: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    marginBottom: 12,
  },
  empty: {
    alignItems: "center",
    paddingVertical: 48,
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
});

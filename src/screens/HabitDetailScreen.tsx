import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import HabitCalendar from "../components/HabitCalendar";
import HabitFields from "../components/HabitFields";
import { useAccomplishments } from "../lib/AccomplishmentsContext";
import { refreshHabitReminders } from "../lib/habitReminders";
import {
  cadenceLabel,
  checkinTimeFor,
  dayKey,
  latestCheckinThisPeriod,
  periodPhrase,
  progressLabel,
  streakLabel,
} from "../lib/habits";
import { addCheckin, archiveHabit, fetchHabitCheckins, removeCheckin, updateHabit } from "../lib/habitsApi";
import { statusesFor } from "../lib/useHabits";
import { colors } from "../lib/theme";
import type { TasksStackParamList } from "../navigation/types";
import type { HabitCheckin, HabitDraft, HabitRow } from "../types/habit";

type Props = NativeStackScreenProps<TasksStackParamList, "HabitDetail">;


function lookbackStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear() - 1, now.getMonth(), 1);
}


// One habit: how it's going this period, its streak, a check-in button, a
// calendar of its history (where earlier days can be checked off or undone),
// and its settings.
export default function HabitDetailScreen({ route, navigation }: Props) {
  const { recordCheckin, recordCheckinRemoved, refresh: refreshAccomplishments } = useAccomplishments();
  const [habit, setHabit] = useState<HabitRow>(route.params.habit);
  const [checkins, setCheckins] = useState<HabitCheckin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  // dayKey of a calendar day whose change is being saved.
  const [busyDay, setBusyDay] = useState<string | null>(null);
  const loadId = useRef(0);

  useLayoutEffect(() => {
    navigation.setOptions({ title: "Habit" });
  }, [navigation]);

  const load = useCallback(async () => {
    const id = ++loadId.current;
    const rows = await fetchHabitCheckins(lookbackStart(), habit.id);
    if (id !== loadId.current) return;
    if (!rows) {
      setError("Couldn't load this habit's check-ins.");
      return;
    }
    setError(null);
    setCheckins(rows);
  }, [habit.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const status = useMemo(
    () => (checkins ? statusesFor([habit], checkins, new Date())[0] : null),
    [habit, checkins]
  );

  async function handleCheckIn() {
    if (!checkins || isCheckingIn) return;
    setIsCheckingIn(true);
    const { data, error: insertError } = await addCheckin(habit.id);
    setIsCheckingIn(false);
    if (insertError || !data) {
      Alert.alert("Couldn't check in", insertError ?? "Please try again.");
      return;
    }
    loadId.current += 1;
    const next = [...checkins, data];
    setCheckins(next);
    recordCheckin(habit.cadence, statusesFor([habit], next, new Date())[0].progress);
    refreshHabitReminders();
  }

  // Removes a check-in and updates everything that depends on it.
  async function removeAndUpdate(checkin: HabitCheckin) {
    const removeError = await removeCheckin(checkin.id);
    if (removeError) {
      Alert.alert("Couldn't remove it", removeError);
      return;
    }
    loadId.current += 1;
    setCheckins((prev) => (prev ?? []).filter((c) => c.id !== checkin.id));
    recordCheckinRemoved();
    refreshHabitReminders();
  }

  // For a mis-tap: takes back this period's latest check-in straight away.
  async function handleUndoLast() {
    const latest = checkins ? latestCheckinThisPeriod(habit.cadence, checkins, new Date()) : null;
    if (!latest || isCheckingIn) return;
    setIsCheckingIn(true);
    await removeAndUpdate(latest);
    setIsCheckingIn(false);
  }

  // Checks the habit off for a day from the calendar - today or earlier.
  async function checkInOn(day: Date) {
    if (!checkins) return;
    const now = new Date();
    if (dayKey(day) === dayKey(now)) {
      await handleCheckIn();
      return;
    }
    setBusyDay(dayKey(day));
    const { data, error: insertError } = await addCheckin(habit.id, checkinTimeFor(day, now));
    setBusyDay(null);
    if (insertError || !data) {
      Alert.alert("Couldn't check it off", insertError ?? "Please try again.");
      return;
    }
    loadId.current += 1;
    setCheckins((prev) => [...(prev ?? []), data]);
    // Not today's count, so no "done today" toast - just bring the Profile
    // numbers and reminders up to date.
    refreshAccomplishments();
    refreshHabitReminders();
  }

  function handleDayPress(day: Date, dayCheckins: HabitCheckin[]) {
    if (dayCheckins.length === 0) {
      checkInOn(day);
      return;
    }
    const label = day.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    // The latest one that day is what gets taken back.
    const latest = [...dayCheckins].sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1))[0];
    const canAddAnother = habit.cadence === "daily" && dayCheckins.length < habit.target_count;
    Alert.alert(
      label,
      dayCheckins.length === 1 ? "Checked off this day." : `Checked off ${dayCheckins.length} times this day.`,
      [
        ...(canAddAnother ? [{ text: "Check in again", onPress: () => checkInOn(day) }] : []),
        {
          text: dayCheckins.length === 1 ? "Uncheck" : "Remove one",
          style: "destructive" as const,
          onPress: async () => {
            setBusyDay(dayKey(day));
            await removeAndUpdate(latest);
            setBusyDay(null);
          },
        },
        { text: "Cancel", style: "cancel" as const },
      ]
    );
  }

  async function handleChange(updated: HabitDraft): Promise<string | null> {
    const { data, error: updateError } = await updateHabit(habit.id, updated);
    if (updateError || !data) return updateError ?? "Please try again.";
    setHabit(data);
    refreshHabitReminders();
    return null;
  }

  function handleDelete() {
    Alert.alert(
      "Delete this habit?",
      "It'll disappear from your lists and stop reminding you. What you've already done still counts on your Profile.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const deleteError = await archiveHabit(habit.id);
            if (deleteError) {
              Alert.alert("Couldn't delete it", deleteError);
              return;
            }
            refreshHabitReminders();
            navigation.goBack();
          },
        },
      ]
    );
  }

  const progress = status?.progress;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{habit.title}</Text>
      <Text style={styles.cadence}>{cadenceLabel(habit.cadence, habit.target_count)}</Text>

      <View style={styles.statusCard}>
        {!progress ? (
          error ? (
            <Text style={styles.error}>{error}</Text>
          ) : (
            <ActivityIndicator color={colors.accent} />
          )
        ) : (
          <>
            <View style={styles.statusRow}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>
                  {progress.done}/{progress.target}
                </Text>
                <Text style={styles.statLabel}>Done {periodPhrase(habit.cadence)}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>🔥 {progress.streak}</Text>
                <Text style={styles.statLabel}>{streakLabel(habit.cadence, progress.streak).split(" ")[1]} in a row</Text>
              </View>
            </View>
            <Pressable
              onPress={handleCheckIn}
              disabled={progress.met || isCheckingIn}
              style={[styles.checkInButton, progress.met && styles.checkInButtonDone]}
              accessibilityRole="button"
            >
              {isCheckingIn ? (
                <ActivityIndicator color={colors.onSurfaceInverse} />
              ) : (
                <>
                  <Ionicons name="checkmark" size={18} color={progress.met ? colors.success : colors.onSurfaceInverse} />
                  <Text style={[styles.checkInText, progress.met && styles.checkInTextDone]}>
                    {progress.met ? progressLabel(habit.cadence, progress) : "Check in"}
                  </Text>
                </>
              )}
            </Pressable>
            {progress.done > 0 && (
              <Pressable
                onPress={handleUndoLast}
                disabled={isCheckingIn}
                hitSlop={8}
                style={styles.undoButton}
                accessibilityRole="button"
              >
                <Ionicons name="arrow-undo-outline" size={15} color={colors.textSecondary} />
                <Text style={styles.undoText}>{progress.met ? "Uncheck" : "Undo last check-in"}</Text>
              </Pressable>
            )}
          </>
        )}
      </View>

      {checkins && (
        <>
          <Text style={styles.sectionTitle}>History</Text>
          <HabitCalendar
            checkins={checkins}
            cadence={habit.cadence}
            target={habit.target_count}
            earliest={lookbackStart()}
            busyDay={busyDay}
            onDayPress={handleDayPress}
          />
        </>
      )}

      <Text style={styles.sectionTitle}>Settings</Text>
      <HabitFields habit={habit} onChange={handleChange} />

      <Pressable onPress={handleDelete} style={styles.deleteButton} accessibilityRole="button">
        <Ionicons name="trash-outline" size={16} color={colors.danger} />
        <Text style={styles.deleteText}>Delete habit</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 16,
    paddingBottom: 48,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  cadence: {
    fontSize: 15,
    color: colors.textSecondary,
    marginTop: 4,
  },
  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginTop: 16,
    minHeight: 80,
    justifyContent: "center",
  },
  statusRow: {
    flexDirection: "row",
  },
  stat: {
    flex: 1,
  },
  statValue: {
    fontSize: 26,
    fontWeight: "800",
    color: colors.textPrimary,
    fontVariant: ["tabular-nums"],
  },
  statLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  checkInButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.success,
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 16,
  },
  checkInButtonDone: {
    backgroundColor: colors.successSoft,
  },
  undoButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 12,
  },
  undoText: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: "600",
  },
  checkInText: {
    color: colors.onSurfaceInverse,
    fontSize: 16,
    fontWeight: "700",
  },
  checkInTextDone: {
    color: colors.success,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: colors.textSecondary,
    marginTop: 24,
    marginBottom: 10,
  },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 32,
    paddingVertical: 12,
  },
  deleteText: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: "600",
  },
});

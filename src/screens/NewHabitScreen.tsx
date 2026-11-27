import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useLayoutEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import HabitFields from "../components/HabitFields";
import { refreshHabitReminders } from "../lib/habitReminders";
import { blankHabit, cadenceLabel, finalizeHabit } from "../lib/habits";
import { createHabit, fetchHabits } from "../lib/habitsApi";
import { HABIT_SUGGESTIONS, hasHabitTitled, type HabitSuggestion } from "../lib/habitSuggestions";
import { ensureNotificationPermission } from "../lib/notifications";
import { colors } from "../lib/theme";
import type { TasksStackParamList } from "../navigation/types";
import type { HabitDraft } from "../types/habit";

type Props = NativeStackScreenProps<TasksStackParamList, "NewHabit">;

// Starting a habit: pick one of the common ones or make your own, then adjust
// it in the form and save. Kept apart from the AI chat, which is for tasks and
// events.
export default function NewHabitScreen({ navigation }: Props) {
  // Null while choosing; set once a suggestion (or "your own") is picked.
  const [draft, setDraft] = useState<HabitDraft | null>(null);
  const [fromSuggestion, setFromSuggestion] = useState(false);
  const [existingTitles, setExistingTitles] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ title: draft ? (fromSuggestion ? "Add habit" : "Your own habit") : "New habit" });
  }, [navigation, draft, fromSuggestion]);

  useFocusEffect(
    useCallback(() => {
      fetchHabits().then(({ data }) => {
        if (data) setExistingTitles(data.map((h) => h.title));
      });
    }, [])
  );

  function pickSuggestion(suggestion: HabitSuggestion) {
    setError(null);
    setFromSuggestion(true);
    setDraft({ ...suggestion.draft });
  }

  function startCustom() {
    setError(null);
    setFromSuggestion(false);
    setDraft(blankHabit());
  }

  async function handleSave() {
    if (!draft) return;
    const habit = finalizeHabit(draft);
    if (!habit.title) return;
    setIsSaving(true);
    setError(null);
    if (habit.reminder_time) await ensureNotificationPermission();
    const { error: insertError } = await createHabit(habit);
    setIsSaving(false);
    if (insertError) {
      setError(insertError);
      return;
    }
    refreshHabitReminders();
    navigation.goBack();
  }

  if (draft) {
    const canSave = draft.title.trim().length > 0 && !isSaving;
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TextInput
            style={styles.titleInput}
            placeholder="What habit do you want to keep?"
            placeholderTextColor={colors.textMuted}
            value={draft.title}
            onChangeText={(title) => setDraft((prev) => (prev ? { ...prev, title } : prev))}
            autoFocus={!fromSuggestion}
            multiline
          />
          <Text style={styles.formHint}>
            {fromSuggestion
              ? "Change anything you like - how often, a reminder, notes - then save."
              : "Set how often you want to do it. A reminder is optional."}
          </Text>
          <HabitFields habit={draft} onChange={(updated) => setDraft({ ...updated, title: draft.title })} hideTitle />
          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>

        <View style={styles.actionsBar}>
          <Pressable onPress={() => setDraft(null)} disabled={isSaving} hitSlop={8}>
            <Text style={styles.backText}>Back to suggestions</Text>
          </Pressable>
          <Pressable
            onPress={handleSave}
            disabled={!canSave}
            style={[styles.saveButton, !canSave && styles.disabled]}
            accessibilityRole="button"
          >
            {isSaving ? (
              <ActivityIndicator color={colors.onSurfaceInverse} size="small" />
            ) : (
              <Text style={styles.saveText}>Save habit</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Pressable
        onPress={startCustom}
        style={({ pressed }) => [styles.customCard, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <View style={styles.customIcon}>
          <Ionicons name="add" size={22} color={colors.onSurfaceInverse} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.customTitle}>Create your own</Text>
          <Text style={styles.customSubtitle}>Anything you want to do daily, weekly or monthly</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </Pressable>

      <Text style={styles.heading}>Popular habits</Text>
      <Text style={styles.subheading}>Tap one to set it up.</Text>

      {HABIT_SUGGESTIONS.map((group) => (
        <View key={group.title} style={styles.group}>
          <Text style={styles.groupTitle}>{group.title}</Text>
          <View style={styles.groupCard}>
            {group.habits.map((suggestion, i) => {
              const added = hasHabitTitled(existingTitles, suggestion.draft.title);
              return (
                <Pressable
                  key={suggestion.draft.title}
                  onPress={() => pickSuggestion(suggestion)}
                  disabled={added}
                  style={({ pressed }) => [styles.suggestion, i > 0 && styles.suggestionBorder, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`${suggestion.draft.title}, ${cadenceLabel(suggestion.draft.cadence, suggestion.draft.target_count)}${added ? ", already added" : ""}`}
                  accessibilityState={{ disabled: added }}
                >
                  <View style={styles.emojiWrap}>
                    <Text style={styles.emoji}>{suggestion.emoji}</Text>
                  </View>
                  <View style={styles.flex}>
                    <Text style={[styles.suggestionTitle, added && styles.added]}>{suggestion.draft.title}</Text>
                    <Text style={styles.suggestionCadence}>
                      {cadenceLabel(suggestion.draft.cadence, suggestion.draft.target_count)}
                    </Text>
                  </View>
                  {added ? (
                    <View style={styles.addedPill}>
                      <Ionicons name="checkmark" size={12} color={colors.success} />
                      <Text style={styles.addedText}>Added</Text>
                    </View>
                  ) : (
                    <Ionicons name="add-circle-outline" size={24} color={colors.accent} />
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
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
    paddingBottom: 40,
  },
  flex: {
    flex: 1,
  },
  pressed: {
    opacity: 0.6,
  },
  customCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  customIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  customTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  customSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  heading: {
    fontSize: 20,
    fontWeight: "800",
    color: colors.textPrimary,
    marginTop: 28,
  },
  subheading: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  group: {
    marginTop: 18,
  },
  groupTitle: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: colors.textSecondary,
    marginBottom: 8,
  },
  groupCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
  },
  suggestion: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
  suggestionBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  emojiWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  emoji: {
    fontSize: 20,
  },
  suggestionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  added: {
    color: colors.textSecondary,
  },
  suggestionCadence: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 1,
  },
  addedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: colors.successSoft,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  addedText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.success,
  },
  titleInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
    fontWeight: "600",
    color: colors.textPrimary,
    minHeight: 56,
  },
  formHint: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 10,
    marginBottom: 12,
  },
  error: {
    color: colors.danger,
    marginTop: 10,
  },
  actionsBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  backText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  saveButton: {
    backgroundColor: colors.accent,
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 24,
    minWidth: 120,
    alignItems: "center",
    justifyContent: "center",
  },
  saveText: {
    color: colors.onSurfaceInverse,
    fontSize: 16,
    fontWeight: "600",
  },
  disabled: {
    opacity: 0.5,
  },
});

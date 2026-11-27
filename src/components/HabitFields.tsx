import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { EditorActions, FieldRow, SegmentedControl, fieldEditorStyles } from "./FieldEditorUI";
import TimePickerField from "./TimePickerField";
import { cadenceLabel, finalizeHabit, formatReminderTime, MAX_TARGET } from "../lib/habits";
import { notesPreview } from "../lib/notes";
import { ensureNotificationPermission } from "../lib/notifications";
import { colors } from "../lib/theme";
import type { HabitCadence, HabitDraft } from "../types/habit";

const DEFAULT_REMINDER = "20:00";
const PERIOD: Record<HabitCadence, string> = { daily: "day", weekly: "week", monthly: "month" };

// Field-by-field editor for a habit, in the same expand/edit/Save style as the
// task editors. Each Save hands the whole updated habit to onChange - the new
// habit screen keeps it in memory, the habit's own screen writes it to the
// database (and may report a failure by returning an error message).
export default function HabitFields({
  habit,
  onChange,
  hideTitle = false,
}: {
  habit: HabitDraft;
  onChange: (updated: HabitDraft) => void | Promise<string | null | void>;
  hideTitle?: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [titleDraft, setTitleDraft] = useState(habit.title);
  const [cadenceDraft, setCadenceDraft] = useState<HabitCadence>(habit.cadence);
  const [targetDraft, setTargetDraft] = useState(habit.target_count);
  const [reminderDraft, setReminderDraft] = useState(habit.reminder_time ?? DEFAULT_REMINDER);
  const [notesDraft, setNotesDraft] = useState(habit.notes ?? "");

  function toggle(key: string) {
    if (expanded === key) {
      setExpanded(null);
      return;
    }
    setTitleDraft(habit.title);
    setCadenceDraft(habit.cadence);
    setTargetDraft(habit.target_count);
    setReminderDraft(habit.reminder_time ?? DEFAULT_REMINDER);
    setNotesDraft(habit.notes ?? "");
    setExpanded(key);
  }

  async function save(patch: Partial<HabitDraft>) {
    setSaving(true);
    const error = await onChange(finalizeHabit({ ...habit, ...patch }));
    setSaving(false);
    if (error) {
      Alert.alert("Couldn't save", error);
      return;
    }
    setExpanded(null);
  }

  async function saveReminder() {
    const granted = await ensureNotificationPermission();
    if (!granted) {
      Alert.alert(
        "Notifications are off",
        "The reminder is saved, but you won't get it until notifications are turned on for Aidha in Settings."
      );
    }
    await save({ reminder_time: reminderDraft });
  }

  const reminderText = formatReminderTime(habit.reminder_time);
  const maxTarget = MAX_TARGET[cadenceDraft];
  const target = Math.min(targetDraft, maxTarget);

  return (
    <View style={fieldEditorStyles.detailsCard}>
      {!hideTitle && (
        <FieldRow
          icon="create-outline"
          label="Title"
          value={habit.title}
          expanded={expanded === "title"}
          onToggle={() => toggle("title")}
        >
          <View style={fieldEditorStyles.inlineEditorRow}>
            <TextInput style={fieldEditorStyles.inlineInput} value={titleDraft} onChangeText={setTitleDraft} autoFocus />
          </View>
          <EditorActions
            onSave={() => titleDraft.trim() && save({ title: titleDraft })}
            onCancel={() => setExpanded(null)}
            saving={saving}
          />
        </FieldRow>
      )}

      <FieldRow
        icon="repeat-outline"
        label="How often"
        value={cadenceLabel(habit.cadence, habit.target_count)}
        expanded={expanded === "cadence"}
        onToggle={() => toggle("cadence")}
      >
        <SegmentedControl
          options={[
            { label: "Daily", value: "daily" as HabitCadence },
            { label: "Weekly", value: "weekly" as HabitCadence },
            { label: "Monthly", value: "monthly" as HabitCadence },
          ]}
          value={cadenceDraft}
          onChange={setCadenceDraft}
        />
        <View style={styles.stepperRow}>
          <Pressable
            onPress={() => setTargetDraft(Math.max(1, target - 1))}
            disabled={target <= 1}
            style={[styles.stepperButton, target <= 1 && styles.disabled]}
            accessibilityRole="button"
            accessibilityLabel="Fewer times"
          >
            <Ionicons name="remove" size={18} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.stepperText}>
            {target} {target === 1 ? "time" : "times"} a {PERIOD[cadenceDraft]}
          </Text>
          <Pressable
            onPress={() => setTargetDraft(Math.min(maxTarget, target + 1))}
            disabled={target >= maxTarget}
            style={[styles.stepperButton, target >= maxTarget && styles.disabled]}
            accessibilityRole="button"
            accessibilityLabel="More times"
          >
            <Ionicons name="add" size={18} color={colors.textPrimary} />
          </Pressable>
        </View>
        <EditorActions
          onSave={() => save({ cadence: cadenceDraft, target_count: target })}
          onCancel={() => setExpanded(null)}
          saving={saving}
        />
      </FieldRow>

      <FieldRow
        icon="alarm-outline"
        label="Reminder"
        value={reminderText ?? "None"}
        expanded={expanded === "reminder"}
        onToggle={() => toggle("reminder")}
      >
        <Text style={styles.hint}>
          {habit.cadence === "daily"
            ? "Reminds you at this time on days you haven't done it yet."
            : `Reminds you at this time when the ${PERIOD[habit.cadence]} is nearly over and it's still not done.`}
        </Text>
        <TimePickerField value={reminderDraft} onChange={setReminderDraft} />
        <View style={styles.reminderActions}>
          <EditorActions onSave={saveReminder} onCancel={() => setExpanded(null)} saving={saving} />
          {habit.reminder_time && (
            <Pressable onPress={() => save({ reminder_time: null })} disabled={saving} hitSlop={8}>
              <Text style={styles.removeLink}>Turn off</Text>
            </Pressable>
          )}
        </View>
      </FieldRow>

      <FieldRow
        icon="document-text-outline"
        label="Notes"
        value={notesPreview(habit.notes) ?? "Not set"}
        expanded={expanded === "notes"}
        onToggle={() => toggle("notes")}
        bordered={false}
      >
        <TextInput
          style={[fieldEditorStyles.inlineInput, fieldEditorStyles.notesInput]}
          value={notesDraft}
          onChangeText={setNotesDraft}
          placeholder="Why it matters, how you'll do it, anything to remember"
          placeholderTextColor={colors.textMuted}
          multiline
          autoFocus
          textAlignVertical="top"
        />
        <EditorActions onSave={() => save({ notes: notesDraft })} onCancel={() => setExpanded(null)} saving={saving} />
      </FieldRow>
    </View>
  );
}

const styles = StyleSheet.create({
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: 12,
  },
  stepperButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textPrimary,
    minWidth: 130,
    textAlign: "center",
  },
  disabled: {
    opacity: 0.4,
  },
  hint: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  reminderActions: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  removeLink: {
    color: colors.danger,
    fontSize: 14,
  },
});

import { Ionicons } from "@expo/vector-icons";
import { useLayoutEffect, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { confirmDelete } from "../lib/confirmDelete";
import { isoToLocalNaive, localIsoNow, localNaiveToUtcIso } from "../lib/localDatetime";
import { getCurrentUserLocation } from "../lib/locationPermission";
import { openInMaps } from "../lib/maps";
import { cancelNotification } from "../lib/notifications";
import { updateDepartureForTask } from "../lib/scheduleDeparture";
import { supabase } from "../lib/supabase";
import { colors } from "../lib/theme";
import type { TasksStackParamList } from "../navigation/types";
import type {
  ConversationTurn,
  DateCertainty,
  EditTaskResponse,
  PlaceType,
  Priority,
  RecurringFrequency,
  TaskPatch,
  TaskRow,
  TaskType,
} from "../types/task";

type Props = NativeStackScreenProps<TasksStackParamList, "EditTask">;

const NO_PLACE_TYPE = "none" as const;
const NO_RECURRENCE = "none" as const;
const NO_PRIORITY = "none" as const;

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function isoToDateParts(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return { date, time };
}

function datePartsToIso(date: string, time: string): string | null {
  const trimmedDate = date.trim();
  if (!trimmedDate) return null;

  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmedDate);
  if (!dateMatch) throw new Error("Date must be in YYYY-MM-DD format.");

  const trimmedTime = time.trim();
  let hours = 0;
  let minutes = 0;
  if (trimmedTime) {
    const timeMatch = /^(\d{2}):(\d{2})$/.exec(trimmedTime);
    if (!timeMatch) throw new Error("Time must be in HH:MM format.");
    hours = Number(timeMatch[1]);
    minutes = Number(timeMatch[2]);
  }

  const [, year, month, day] = dateMatch;
  const result = new Date(Number(year), Number(month) - 1, Number(day), hours, minutes);
  if (Number.isNaN(result.getTime())) throw new Error("Invalid date or time.");
  return result.toISOString();
}

function formatDateDisplay(iso: string | null): string {
  if (!iso) return "Not set";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Not set";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatTimeDisplay(iso: string | null): string {
  if (!iso) return "Not set";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Not set";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatFullDatetime(iso: string | null): string {
  if (!iso) return "cleared";
  return `${formatDateDisplay(iso)} at ${formatTimeDisplay(iso)}`;
}

// Diffs two task snapshots into a plain-English description for the title-sync
// check, e.g. "location changed from "Crown Shy" to "Thai Villa"." Returns null
// when nothing actually changed (e.g. the user re-saved the same value).
function describeChange(before: TaskRow, after: TaskRow): string | null {
  const parts: string[] = [];

  if (before.type !== after.type) parts.push(`type changed to "${after.type}"`);
  if (before.date_certainty !== after.date_certainty) {
    parts.push(`date certainty changed to "${after.date_certainty}"`);
  }
  if (before.datetime !== after.datetime) {
    parts.push(`date/time changed to ${formatFullDatetime(after.datetime)}`);
  }
  if (before.location_raw_text !== after.location_raw_text) {
    parts.push(
      `location changed from "${before.location_raw_text ?? "none"}" to "${after.location_raw_text ?? "none"}"`
    );
  }
  if (before.location_place_type !== after.location_place_type) {
    parts.push(`location type changed to "${after.location_place_type ?? "none"}"`);
  }
  if (before.priority !== after.priority) {
    parts.push(`priority changed to "${after.priority ?? "none"}"`);
  }
  if (before.recurring_frequency !== after.recurring_frequency || before.recurring_detail !== after.recurring_detail) {
    parts.push(
      `recurrence changed to "${after.recurring_frequency ?? "none"}"${
        after.recurring_detail ? ` (${after.recurring_detail})` : ""
      }`
    );
  }
  if (before.requires_downtime !== after.requires_downtime) {
    parts.push(`requires downtime changed to ${after.requires_downtime}`);
  }

  if (parts.length === 0) return null;
  return `The user just changed: ${parts.join(", ")}.`;
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segmentedControl}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected && styles.segmentSelected]}
          >
            <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function EditorActions({
  onSave,
  onCancel,
  saving,
}: {
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <View style={styles.editorActionsRow}>
      <Pressable onPress={onSave} disabled={saving} style={[styles.saveChip, saving && styles.buttonDisabled]}>
        {saving ? (
          <ActivityIndicator color={colors.onSurfaceInverse} size="small" />
        ) : (
          <Text style={styles.saveChipText}>Save</Text>
        )}
      </Pressable>
      <Pressable onPress={onCancel} disabled={saving} hitSlop={8}>
        <Text style={styles.cancelLink}>Cancel</Text>
      </Pressable>
    </View>
  );
}

function FieldRow({
  icon,
  iconBackground,
  iconColor = colors.textSecondary,
  label,
  value,
  valueColor,
  expanded,
  onToggle,
  bordered = true,
  readOnly = false,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconBackground?: string;
  iconColor?: string;
  label: string;
  value: string;
  valueColor?: string;
  expanded: boolean;
  onToggle: () => void;
  bordered?: boolean;
  readOnly?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <View style={[styles.fieldRow, bordered && styles.fieldRowBorder]}>
      <Pressable style={styles.fieldRowHeader} onPress={onToggle} disabled={readOnly}>
        <View style={[styles.fieldIcon, iconBackground ? { backgroundColor: iconBackground } : null]}>
          <Ionicons name={icon} size={16} color={iconColor} />
        </View>
        <View style={styles.fieldRowText}>
          <Text style={styles.fieldRowLabel}>{label}</Text>
          <Text style={[styles.fieldRowValue, valueColor ? { color: valueColor } : null]} numberOfLines={1}>
            {value}
          </Text>
        </View>
        {!readOnly && <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
      </Pressable>
      {expanded && <View style={styles.fieldEditor}>{children}</View>}
    </View>
  );
}

function AskBubble({ role, children }: { role: "user" | "assistant"; children: string }) {
  return (
    <View style={[styles.askBubble, role === "user" ? styles.askBubbleUser : styles.askBubbleAssistant]}>
      <Text style={role === "user" ? styles.askBubbleTextUser : styles.askBubbleTextAssistant}>{children}</Text>
    </View>
  );
}

export default function EditTaskScreen({ route, navigation }: Props) {
  const [taskData, setTaskData] = useState<TaskRow>(route.params.task);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [savingField, setSavingField] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSettingUpDeparture, setIsSettingUpDeparture] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dateParts = isoToDateParts(taskData.datetime);
  const [titleDraft, setTitleDraft] = useState(taskData.title);
  const [locationDraft, setLocationDraft] = useState(taskData.location_raw_text ?? "");
  const [dateDraft, setDateDraft] = useState(dateParts.date);
  const [timeDraft, setTimeDraft] = useState(dateParts.time);
  const [typeDraft, setTypeDraft] = useState<TaskType>(taskData.type);
  const [dateCertaintyDraft, setDateCertaintyDraft] = useState<DateCertainty>(taskData.date_certainty);
  const [locationTypeDraft, setLocationTypeDraft] = useState<PlaceType | typeof NO_PLACE_TYPE>(
    taskData.location_place_type ?? NO_PLACE_TYPE
  );
  const [priorityDraft, setPriorityDraft] = useState<Priority | typeof NO_PRIORITY>(
    taskData.priority ?? NO_PRIORITY
  );
  const [recurrenceFrequencyDraft, setRecurrenceFrequencyDraft] = useState<
    RecurringFrequency | typeof NO_RECURRENCE
  >(taskData.recurring_frequency ?? NO_RECURRENCE);
  const [recurrenceDetailDraft, setRecurrenceDetailDraft] = useState(taskData.recurring_detail ?? "");
  const [requiresDowntimeDraft, setRequiresDowntimeDraft] = useState(taskData.requires_downtime);

  const [askMessages, setAskMessages] = useState<ConversationTurn[]>([]);
  const [askDraft, setAskDraft] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  async function handleDelete() {
    const confirmed = await confirmDelete(`Delete "${taskData.title}"? This can't be undone.`);
    if (!confirmed) return;

    setError(null);
    setIsDeleting(true);
    await cancelNotification(taskData.leaving_notification_id);
    const { error: deleteError } = await supabase.from("tasks").delete().eq("id", taskData.id);
    setIsDeleting(false);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    navigation.goBack();
  }

  useLayoutEffect(() => {
    navigation.setOptions({
      title: "Edit task",
      headerBackTitle: "Tasks",
      headerRight: () => (
        <Pressable onPress={handleDelete} disabled={isDeleting} hitSlop={8}>
          {isDeleting ? (
            <ActivityIndicator size="small" color={colors.danger} />
          ) : (
            <Ionicons name="trash-outline" size={20} color={colors.danger} />
          )}
        </Pressable>
      ),
      // eslint-disable-next-line react-hooks/exhaustive-deps
    });
  }, [navigation, isDeleting, taskData.id, taskData.title]);

  function toggleField(key: string) {
    setExpanded((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (next[key]) resetDraft(key);
      return next;
    });
  }

  function closeField(key: string) {
    setExpanded((prev) => ({ ...prev, [key]: false }));
  }

  function resetDraft(key: string) {
    const parts = isoToDateParts(taskData.datetime);
    switch (key) {
      case "title":
        setTitleDraft(taskData.title);
        break;
      case "location":
        setLocationDraft(taskData.location_raw_text ?? "");
        break;
      case "date":
        setDateDraft(parts.date);
        break;
      case "time":
        setTimeDraft(parts.time);
        break;
      case "type":
        setTypeDraft(taskData.type);
        break;
      case "dateCertainty":
        setDateCertaintyDraft(taskData.date_certainty);
        break;
      case "locationType":
        setLocationTypeDraft(taskData.location_place_type ?? NO_PLACE_TYPE);
        break;
      case "priority":
        setPriorityDraft(taskData.priority ?? NO_PRIORITY);
        break;
      case "recurrence":
        setRecurrenceFrequencyDraft(taskData.recurring_frequency ?? NO_RECURRENCE);
        setRecurrenceDetailDraft(taskData.recurring_detail ?? "");
        break;
      case "requiresDowntime":
        setRequiresDowntimeDraft(taskData.requires_downtime);
        break;
    }
  }

  async function saveField(key: string, patch: Record<string, unknown>) {
    setError(null);
    setSavingField(key);
    const previous = taskData;
    const { data, error: updateError } = await supabase
      .from("tasks")
      .update(patch)
      .eq("id", taskData.id)
      .select()
      .single();
    setSavingField(null);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    const updated = data as TaskRow;
    setTaskData(updated);
    closeField(key);

    if (key !== "title") {
      syncTitleIfNeeded(previous, updated);
    }
    if (key === "location" || key === "date" || key === "time" || key === "dateCertainty") {
      maybeUpdateDeparture(updated);
    }
  }

  // Recomputes (or clears) the departure reminder in the background after a manual
  // edit touches location or date/time. No loading state or error surfaced here -
  // same reasoning as syncTitleIfNeeded, this is a nicety layered on top of an edit
  // that already succeeded on its own.
  async function maybeUpdateDeparture(task: TaskRow) {
    try {
      const userLocation = await getCurrentUserLocation();
      if (!userLocation) return;
      const updated = await updateDepartureForTask(task, userLocation);
      setTaskData(updated);
    } catch {
      // Best-effort background recompute - ignore failures.
    }
  }

  // Explicit, user-initiated retry for a task that has a location and a time
  // but never got a "leaving by" set up at all - typically because location
  // access wasn't available at save time (see NewTaskScreen), which fails
  // silently by design there. This one shows its own loading state and a
  // clear error if location still isn't available, since here it's the
  // user's actual action, not a background nicety layered on a save that
  // already succeeded on its own.
  async function handleSetupDeparture() {
    setIsSettingUpDeparture(true);
    setError(null);
    const userLocation = await getCurrentUserLocation();
    if (!userLocation) {
      setIsSettingUpDeparture(false);
      setError("Couldn't access your location. Check that location access is enabled for this app, then try again.");
      return;
    }
    const updated = await updateDepartureForTask(taskData, userLocation);
    setTaskData(updated);
    setIsSettingUpDeparture(false);

    // updateDepartureForTask falls back to returning the task unchanged if the
    // database write itself failed (e.g. a column the DB doesn't have yet) -
    // without this check the button would just silently revert to its
    // original state with no indication anything went wrong.
    if (!updated.leaving_by && !updated.leaving_by_error) {
      setError(
        "Something went wrong saving the reminder. Make sure your database is up to date (npx supabase db push) and try again."
      );
    }
  }

  // Runs after any manual (non-title) field save. Silently asks the model whether the
  // title is now stale given what changed, and applies just the title if so - no
  // loading state or error surfaced here, since this is a background nicety, not a
  // user-initiated action the field's own Save button already completed successfully.
  async function syncTitleIfNeeded(previous: TaskRow, next: TaskRow) {
    const description = describeChange(previous, next);
    if (!description) return;

    try {
      const { data, error: fnError } = await supabase.functions.invoke("edit-task", {
        body: {
          task: buildAiTaskPayload(next),
          messages: [{ role: "user", content: description }],
          current_datetime: localIsoNow(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          title_sync_only: true,
        },
      });

      if (fnError) return;
      const response = data as EditTaskResponse;
      if (response.type !== "result") return;
      const nextTitle = response.data.title;
      if (nextTitle === undefined || nextTitle === next.title) return;

      const { data: retitled, error: updateError } = await supabase
        .from("tasks")
        .update({ title: nextTitle })
        .eq("id", next.id)
        .select()
        .single();
      if (updateError) return;

      setTaskData(retitled as TaskRow);
    } catch {
      // Best-effort background sync - failures here shouldn't disrupt the field edit
      // the user already successfully made.
    }
  }

  function handleSaveTitle() {
    if (!titleDraft.trim()) {
      setError("Title can't be empty.");
      return;
    }
    saveField("title", { title: titleDraft.trim() });
  }

  function handleSaveLocation() {
    const raw = locationDraft.trim();
    saveField("location", {
      location_raw_text: raw ? raw : null,
      location_place_type: raw ? taskData.location_place_type ?? "none" : null,
    });
  }

  function handleSaveDate() {
    try {
      const parts = isoToDateParts(taskData.datetime);
      const nextDatetime = datePartsToIso(dateDraft, parts.time || "00:00");
      saveField("date", { datetime: nextDatetime });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid date.");
    }
  }

  function handleSaveTime() {
    const parts = isoToDateParts(taskData.datetime);
    if (!parts.date) {
      setError("Set a date first.");
      return;
    }
    try {
      const nextDatetime = datePartsToIso(parts.date, timeDraft);
      saveField("time", { datetime: nextDatetime });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid time.");
    }
  }

  function handleSaveType() {
    saveField("type", { type: typeDraft });
  }

  function handleSaveDateCertainty() {
    const patch: Record<string, unknown> = { date_certainty: dateCertaintyDraft };
    if (dateCertaintyDraft === "none") patch.datetime = null;
    saveField("dateCertainty", patch);
  }

  function handleSaveLocationType() {
    saveField("locationType", {
      location_place_type: locationTypeDraft === NO_PLACE_TYPE ? null : locationTypeDraft,
    });
  }

  function handleSavePriority() {
    saveField("priority", { priority: priorityDraft === NO_PRIORITY ? null : priorityDraft });
  }

  function handleSaveRecurrence() {
    saveField("recurrence", {
      recurring_frequency: recurrenceFrequencyDraft === NO_RECURRENCE ? null : recurrenceFrequencyDraft,
      recurring_detail:
        recurrenceFrequencyDraft === NO_RECURRENCE ? null : recurrenceDetailDraft.trim() || null,
    });
  }

  function handleSaveRequiresDowntime() {
    saveField("requiresDowntime", { requires_downtime: requiresDowntimeDraft });
  }

  function buildAiTaskPayload(t: TaskRow) {
    return {
      type: t.type,
      title: t.title,
      datetime: isoToLocalNaive(t.datetime),
      date_certainty: t.date_certainty,
      location: t.location_raw_text
        ? { raw_text: t.location_raw_text, place_type: t.location_place_type ?? "none" }
        : null,
      recurring: t.recurring_frequency
        ? { frequency: t.recurring_frequency, interval_detail: t.recurring_detail ?? "" }
        : null,
      priority: t.priority,
      requires_downtime: t.requires_downtime,
    };
  }

  async function applyAiPatch(patch: TaskPatch) {
    const dbPatch: Record<string, unknown> = {};
    if (patch.type !== undefined) dbPatch.type = patch.type;
    if (patch.title !== undefined) dbPatch.title = patch.title;
    if (patch.datetime !== undefined) {
      dbPatch.datetime = patch.datetime ? localNaiveToUtcIso(patch.datetime) : null;
    }
    if (patch.date_certainty !== undefined) dbPatch.date_certainty = patch.date_certainty;
    if (patch.location !== undefined) {
      dbPatch.location_raw_text = patch.location ? patch.location.raw_text : null;
      dbPatch.location_place_type = patch.location ? patch.location.place_type : null;
    }
    if (patch.recurring !== undefined) {
      dbPatch.recurring_frequency = patch.recurring ? patch.recurring.frequency : null;
      dbPatch.recurring_detail = patch.recurring ? patch.recurring.interval_detail : null;
    }
    if (patch.priority !== undefined) dbPatch.priority = patch.priority;
    if (patch.requires_downtime !== undefined) dbPatch.requires_downtime = patch.requires_downtime;

    if (Object.keys(dbPatch).length === 0) return;

    const { data, error: updateError } = await supabase
      .from("tasks")
      .update(dbPatch)
      .eq("id", taskData.id)
      .select()
      .single();

    if (updateError) {
      setAskError(updateError.message);
      return;
    }

    const updated = data as TaskRow;
    setTaskData(updated);
    setExpanded({});

    if (patch.location !== undefined || patch.datetime !== undefined) {
      maybeUpdateDeparture(updated);
    }
  }

  async function handleAskSend() {
    if (!askDraft.trim()) return;
    const nextMessages: ConversationTurn[] = [...askMessages, { role: "user", content: askDraft.trim() }];
    setAskMessages(nextMessages);
    setAskDraft("");
    setAskError(null);
    setIsAsking(true);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("edit-task", {
        body: {
          task: buildAiTaskPayload(taskData),
          messages: nextMessages,
          current_datetime: localIsoNow(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });

      if (fnError) throw fnError;
      const response = data as EditTaskResponse;

      if (response.type === "question") {
        setAskMessages([...nextMessages, { role: "assistant", content: response.question }]);
      } else {
        await applyAiPatch(response.data);
        setAskMessages([]);
      }
    } catch (err) {
      setAskError(err instanceof Error ? err.message : "Failed to apply change.");
    } finally {
      setIsAsking(false);
    }
  }

  const showDateTimeRows = taskData.date_certainty !== "none";

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionLabel}>Task</Text>
        <Pressable onPress={() => toggleField("title")}>
          <Text style={styles.taskTitle}>{taskData.title}</Text>
        </Pressable>
        {expanded.title && (
          <View style={styles.inlineEditorRow}>
            <TextInput
              style={styles.inlineInput}
              value={titleDraft}
              onChangeText={setTitleDraft}
              autoFocus
            />
            <Pressable
              onPress={handleSaveTitle}
              disabled={savingField === "title"}
              style={[styles.saveChip, savingField === "title" && styles.buttonDisabled]}
            >
              {savingField === "title" ? (
                <ActivityIndicator color={colors.onSurfaceInverse} size="small" />
              ) : (
                <Text style={styles.saveChipText}>Save</Text>
              )}
            </Pressable>
            <Pressable onPress={() => closeField("title")} disabled={savingField === "title"} hitSlop={8}>
              <Text style={styles.cancelLink}>Cancel</Text>
            </Pressable>
          </View>
        )}

        <Text style={styles.sectionLabel}>Details</Text>
        <View style={styles.detailsCard}>
          <FieldRow
            icon="layers-outline"
            label="Type"
            value={capitalize(taskData.type)}
            expanded={!!expanded.type}
            onToggle={() => toggleField("type")}
          >
            <SegmentedControl
              options={[
                { label: "Task", value: "task" as TaskType },
                { label: "Event", value: "event" as TaskType },
              ]}
              value={typeDraft}
              onChange={setTypeDraft}
            />
            <EditorActions onSave={handleSaveType} onCancel={() => closeField("type")} saving={savingField === "type"} />
          </FieldRow>

          <FieldRow
            icon="checkmark-circle-outline"
            label="Date certainty"
            value={capitalize(taskData.date_certainty)}
            expanded={!!expanded.dateCertainty}
            onToggle={() => toggleField("dateCertainty")}
          >
            <SegmentedControl
              options={[
                { label: "Exact", value: "exact" as DateCertainty },
                { label: "Approximate", value: "approximate" as DateCertainty },
                { label: "None", value: "none" as DateCertainty },
              ]}
              value={dateCertaintyDraft}
              onChange={setDateCertaintyDraft}
            />
            <EditorActions
              onSave={handleSaveDateCertainty}
              onCancel={() => closeField("dateCertainty")}
              saving={savingField === "dateCertainty"}
            />
          </FieldRow>

          {showDateTimeRows && (
            <FieldRow
              icon="calendar-outline"
              label="Date"
              value={formatDateDisplay(taskData.datetime)}
              expanded={!!expanded.date}
              onToggle={() => toggleField("date")}
            >
              <View style={styles.inlineEditorRow}>
                <TextInput
                  style={styles.inlineInput}
                  value={dateDraft}
                  onChangeText={setDateDraft}
                  placeholder="2026-08-01"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoFocus
                />
                <Pressable
                  onPress={handleSaveDate}
                  disabled={savingField === "date"}
                  style={[styles.saveChip, savingField === "date" && styles.buttonDisabled]}
                >
                  {savingField === "date" ? (
                    <ActivityIndicator color={colors.onSurfaceInverse} size="small" />
                  ) : (
                    <Text style={styles.saveChipText}>Save</Text>
                  )}
                </Pressable>
                <Pressable onPress={() => closeField("date")} disabled={savingField === "date"} hitSlop={8}>
                  <Text style={styles.cancelLink}>Cancel</Text>
                </Pressable>
              </View>
            </FieldRow>
          )}

          {showDateTimeRows && (
            <FieldRow
              icon="time-outline"
              label="Time"
              value={formatTimeDisplay(taskData.datetime)}
              expanded={!!expanded.time}
              onToggle={() => toggleField("time")}
            >
              <View style={styles.inlineEditorRow}>
                <TextInput
                  style={styles.inlineInput}
                  value={timeDraft}
                  onChangeText={setTimeDraft}
                  placeholder="14:30"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoFocus
                />
                <Pressable
                  onPress={handleSaveTime}
                  disabled={savingField === "time"}
                  style={[styles.saveChip, savingField === "time" && styles.buttonDisabled]}
                >
                  {savingField === "time" ? (
                    <ActivityIndicator color={colors.onSurfaceInverse} size="small" />
                  ) : (
                    <Text style={styles.saveChipText}>Save</Text>
                  )}
                </Pressable>
                <Pressable onPress={() => closeField("time")} disabled={savingField === "time"} hitSlop={8}>
                  <Text style={styles.cancelLink}>Cancel</Text>
                </Pressable>
              </View>
            </FieldRow>
          )}

          <FieldRow
            icon="location-outline"
            label="Location"
            value={taskData.location_raw_text || "Not set"}
            expanded={!!expanded.location}
            onToggle={() => toggleField("location")}
          >
            <View style={styles.inlineEditorRow}>
              <TextInput
                style={styles.inlineInput}
                value={locationDraft}
                onChangeText={setLocationDraft}
                placeholder="Where?"
                placeholderTextColor={colors.textMuted}
                autoFocus
              />
              <Pressable
                onPress={handleSaveLocation}
                disabled={savingField === "location"}
                style={[styles.saveChip, savingField === "location" && styles.buttonDisabled]}
              >
                {savingField === "location" ? (
                  <ActivityIndicator color={colors.onSurfaceInverse} size="small" />
                ) : (
                  <Text style={styles.saveChipText}>Save</Text>
                )}
              </Pressable>
              <Pressable onPress={() => closeField("location")} disabled={savingField === "location"} hitSlop={8}>
                <Text style={styles.cancelLink}>Cancel</Text>
              </Pressable>
            </View>
            {locationDraft.trim().length > 0 && (
              <Pressable
                onPress={() => openInMaps(locationDraft.trim())}
                style={styles.openInMapsButton}
                hitSlop={6}
              >
                <Ionicons name="navigate-outline" size={14} color={colors.accent} />
                <Text style={styles.openInMapsText}>Open in Maps</Text>
              </Pressable>
            )}
          </FieldRow>

          <FieldRow
            icon="pricetag-outline"
            label="Location type"
            value={
              taskData.location_place_type ? capitalize(taskData.location_place_type.replace("_", " ")) : "None"
            }
            expanded={!!expanded.locationType}
            onToggle={() => toggleField("locationType")}
          >
            <SegmentedControl
              options={[
                { label: "None", value: NO_PLACE_TYPE },
                { label: "Address", value: "specific_address" as PlaceType },
                { label: "Place", value: "known_place" as PlaceType },
                { label: "Category", value: "category" as PlaceType },
              ]}
              value={locationTypeDraft}
              onChange={setLocationTypeDraft}
            />
            <EditorActions
              onSave={handleSaveLocationType}
              onCancel={() => closeField("locationType")}
              saving={savingField === "locationType"}
            />
          </FieldRow>

          {/* Shows only when a "leaving by" reminder was never even attempted -
              typically because location access wasn't available at save time,
              which fails silently there by design (see NewTaskScreen). Once
              leaving_by, leaving_by_error, or resolved_address exist, one of
              the two rows below takes over instead. */}
          {taskData.location_raw_text &&
            taskData.datetime &&
            !taskData.resolved_address &&
            !taskData.leaving_by &&
            !taskData.leaving_by_error && (
              <View style={[styles.fieldRow, styles.fieldRowBorder]}>
                <Pressable
                  style={styles.fieldRowHeader}
                  onPress={handleSetupDeparture}
                  disabled={isSettingUpDeparture}
                >
                  <View style={styles.fieldIcon}>
                    <Ionicons name="navigate-outline" size={16} color={colors.accent} />
                  </View>
                  <View style={styles.fieldRowText}>
                    <Text style={styles.fieldRowLabel}>Leaving by</Text>
                    <Text style={[styles.fieldRowValue, { color: colors.accent }]}>
                      {isSettingUpDeparture ? "Setting up…" : "Tap to set up a reminder"}
                    </Text>
                  </View>
                  {isSettingUpDeparture ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  )}
                </Pressable>
              </View>
            )}

          {taskData.resolved_address && (
            <FieldRow
              icon="pin-outline"
              label="Resolved to"
              value={taskData.resolved_address}
              expanded={false}
              onToggle={() => {}}
              readOnly
            />
          )}

          {(taskData.leaving_by || taskData.leaving_by_error) && (
            <FieldRow
              icon="navigate-outline"
              label="Leaving by"
              value={
                taskData.leaving_by_error
                  ? "Unable to calculate"
                  : [
                      formatTimeDisplay(taskData.leaving_by),
                      taskData.departure_origin_label ? `from ${taskData.departure_origin_label}` : null,
                      taskData.travel_directions_summary,
                    ]
                      .filter(Boolean)
                      .join(" · ")
              }
              valueColor={taskData.leaving_by_error ? colors.warning : colors.accent}
              expanded={false}
              onToggle={() => {}}
              readOnly
            />
          )}

          <FieldRow
            icon="flag-outline"
            label="Priority"
            value={taskData.priority ? capitalize(taskData.priority) : "None"}
            expanded={!!expanded.priority}
            onToggle={() => toggleField("priority")}
          >
            <SegmentedControl
              options={[
                { label: "None", value: NO_PRIORITY },
                { label: "Low", value: "low" as Priority },
                { label: "Normal", value: "normal" as Priority },
                { label: "High", value: "high" as Priority },
              ]}
              value={priorityDraft}
              onChange={setPriorityDraft}
            />
            <EditorActions
              onSave={handleSavePriority}
              onCancel={() => closeField("priority")}
              saving={savingField === "priority"}
            />
          </FieldRow>

          <FieldRow
            icon="repeat-outline"
            label="Recurrence"
            value={taskData.recurring_frequency ? capitalize(taskData.recurring_frequency) : "None"}
            expanded={!!expanded.recurrence}
            onToggle={() => toggleField("recurrence")}
          >
            <SegmentedControl
              options={[
                { label: "None", value: NO_RECURRENCE },
                { label: "Daily", value: "daily" as RecurringFrequency },
                { label: "Weekly", value: "weekly" as RecurringFrequency },
                { label: "Monthly", value: "monthly" as RecurringFrequency },
                { label: "Yearly", value: "yearly" as RecurringFrequency },
              ]}
              value={recurrenceFrequencyDraft}
              onChange={setRecurrenceFrequencyDraft}
            />
            {recurrenceFrequencyDraft !== NO_RECURRENCE && (
              <TextInput
                style={[styles.inlineInput, styles.recurrenceDetailInput]}
                value={recurrenceDetailDraft}
                onChangeText={setRecurrenceDetailDraft}
                placeholder="e.g. every other Tuesday"
                placeholderTextColor={colors.textMuted}
              />
            )}
            <EditorActions
              onSave={handleSaveRecurrence}
              onCancel={() => closeField("recurrence")}
              saving={savingField === "recurrence"}
            />
          </FieldRow>

          <FieldRow
            icon="hourglass-outline"
            label="Requires downtime"
            value={taskData.requires_downtime ? "Yes" : "No"}
            expanded={!!expanded.requiresDowntime}
            onToggle={() => toggleField("requiresDowntime")}
            bordered={false}
          >
            <Switch value={requiresDowntimeDraft} onValueChange={setRequiresDowntimeDraft} />
            <EditorActions
              onSave={handleSaveRequiresDowntime}
              onCancel={() => closeField("requiresDowntime")}
              saving={savingField === "requiresDowntime"}
            />
          </FieldRow>
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <Text style={styles.sectionLabel}>Ask AI</Text>
        {askMessages.map((message, index) => (
          <AskBubble key={index} role={message.role}>
            {message.content}
          </AskBubble>
        ))}
        {isAsking && (
          <View style={[styles.askBubble, styles.askBubbleAssistant]}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
          </View>
        )}
        {askError && <Text style={styles.error}>{askError}</Text>}
      </ScrollView>

      <View style={styles.askInputBar}>
        <TextInput
          style={styles.askInput}
          placeholder="Change something..."
          placeholderTextColor={colors.textMuted}
          value={askDraft}
          onChangeText={setAskDraft}
          multiline
        />
        <Pressable
          onPress={handleAskSend}
          disabled={isAsking || !askDraft.trim()}
          style={[styles.askSendButton, (isAsking || !askDraft.trim()) && styles.buttonDisabled]}
        >
          <Ionicons name="arrow-up" size={18} color={colors.onSurfaceInverse} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 16,
    paddingBottom: 24,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 20,
    marginBottom: 8,
  },
  taskTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  detailsCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 14,
    overflow: "hidden",
  },
  fieldRow: {
    paddingHorizontal: 12,
  },
  fieldRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  fieldRowHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 12,
  },
  fieldIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldRowText: {
    flex: 1,
  },
  fieldRowLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  fieldRowValue: {
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: "500",
    marginTop: 1,
  },
  fieldEditor: {
    paddingBottom: 14,
  },
  inlineEditorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
  },
  inlineInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    color: colors.textPrimary,
  },
  recurrenceDetailInput: {
    marginTop: 10,
  },
  segmentedControl: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  segment: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  segmentText: {
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: "500",
  },
  segmentTextSelected: {
    color: colors.onSurfaceInverse,
  },
  editorActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginTop: 10,
  },
  saveChip: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  saveChipText: {
    color: colors.onSurfaceInverse,
    fontSize: 14,
    fontWeight: "600",
  },
  cancelLink: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  openInMapsButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 10,
  },
  openInMapsText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: "500",
  },
  error: {
    color: colors.danger,
    marginTop: 12,
  },
  askBubble: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 8,
    maxWidth: "85%",
  },
  askBubbleAssistant: {
    backgroundColor: colors.surfaceAlt,
    alignSelf: "flex-start",
  },
  askBubbleUser: {
    backgroundColor: colors.accentDark,
    alignSelf: "flex-end",
  },
  askBubbleTextAssistant: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  askBubbleTextUser: {
    color: colors.onSurfaceInverse,
    fontSize: 14,
  },
  askInputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  askInput: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    maxHeight: 100,
    marginRight: 10,
    color: colors.textPrimary,
  },
  askSendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});

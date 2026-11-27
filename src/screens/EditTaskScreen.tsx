import { Ionicons } from "@expo/vector-icons";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { confirmDelete } from "../lib/confirmDelete";
import { DURATION_PRESETS, formatDuration } from "../lib/duration";
import { leavingByDetails } from "../lib/leavingByDetails";
import { effectivePriority } from "../lib/priority";
import { isoToLocalNaive, localIsoNow, localNaiveToUtcIso } from "../lib/localDatetime";
import { getCurrentUserLocation } from "../lib/locationPermission";
import { openInMaps } from "../lib/maps";
import { parseDayOfMonth, parseWeekdays } from "../lib/recurrence";
import { describeRecurrence, WEEK_ORDER, weeklyDays, weeklyDetail } from "../lib/recurrenceLabel";
import { cancelNotification } from "../lib/notifications";
import { refreshLeavingNotification, updateDepartureForTask } from "../lib/scheduleDeparture";
import { supabase } from "../lib/supabase";
import { syncDueNotification } from "../lib/syncDueNotification";
import { colors } from "../lib/theme";
import DatePickerField from "../components/DatePickerField";
import { DurationPicker, EditorActions, SegmentedControl } from "../components/FieldEditorUI";
import TimePickerField from "../components/TimePickerField";
import type { TasksStackParamList } from "../navigation/types";
import type {
  ConversationTurn,
  EditTaskResponse,
  Priority,
  RecurringFrequency,
  TaskPatch,
  TaskRow,
  TaskType,
} from "../types/task";

type Props = NativeStackScreenProps<TasksStackParamList, "EditTask">;

const NO_RECURRENCE = "none" as const;
const NO_PRIORITY = "none" as const;
// What a new date & time starts on.
const DEFAULT_TIME = "09:00";
const PRESET_MINUTES: readonly number[] = DURATION_PRESETS;
const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

// Matches DatePickerField's own fallback when it's given an empty value (it
// visually pre-highlights today on the calendar even though nothing's been
// tapped yet) - without this, opening "Add a reminder" on a task with no
// existing date left dateDraft as "" while the picker showed today already
// selected, so tapping Save without first tapping a day failed with "Enter a
// date for the reminder" - confusing since a date visually looked chosen.
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
  valueLines = 1,
  details,
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
  // How many lines the value may wrap to before it's cut off (default 1).
  valueLines?: number;
  // Extra lines under the value, each shown in full (wrapping as needed).
  details?: string[];
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
          <Text style={[styles.fieldRowValue, valueColor ? { color: valueColor } : null]} numberOfLines={valueLines}>
            {value}
          </Text>
          {details?.map((line, index) => (
            <Text key={index} style={styles.fieldRowDetail}>
              {line}
            </Text>
          ))}
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

// The screen copies its task from the route into its own state when it first
// mounts. If the stack already has this screen open for one task (say you opened
// a task, then switched tabs) and navigation points it at a different task, the
// route's params change but a mounted screen keeps showing the old task. Keying
// on the task id makes it start over for the new one instead.
export default function EditTaskScreen(props: Props) {
  return <EditTaskScreenContent key={props.route.params.task.id} {...props} />;
}

function EditTaskScreenContent({ route, navigation }: Props) {
  const [taskData, setTaskData] = useState<TaskRow>(route.params.task);
  // Which tap-to-open editors are open: "when" (date & time) and "duration"
  // (a custom length). Everything else edits in place.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [savingField, setSavingField] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSettingUpDeparture, setIsSettingUpDeparture] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Typed fields keep a draft while they're being edited and save when the
  // user leaves the field (or the screen).
  const [titleDraft, setTitleDraft] = useState(taskData.title);
  const [locationDraft, setLocationDraft] = useState(taskData.location_raw_text ?? "");
  const [notesDraft, setNotesDraft] = useState(taskData.notes ?? "");
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const dateParts = isoToDateParts(taskData.datetime);
  const [dateDraft, setDateDraft] = useState(dateParts.date);
  const [timeDraft, setTimeDraft] = useState(dateParts.time);
  const [durationDraft, setDurationDraft] = useState<number | null>(taskData.duration_minutes);

  const [askMessages, setAskMessages] = useState<ConversationTurn[]>([]);
  const [askDraft, setAskDraft] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  // When the task changes from elsewhere (Ask AI, the automatic title update),
  // show the new values in any field the user isn't typing in.
  useEffect(() => {
    if (focusedField !== "title") setTitleDraft(taskData.title);
    if (focusedField !== "location") setLocationDraft(taskData.location_raw_text ?? "");
    if (focusedField !== "notes") setNotesDraft(taskData.notes ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskData.title, taskData.location_raw_text, taskData.notes]);

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

  async function handleDelete() {
    const confirmed = await confirmDelete(`Delete "${taskData.title}"? This can't be undone.`);
    if (!confirmed) return;

    setError(null);
    setIsDeleting(true);
    await cancelNotification(taskData.leaving_notification_id);
    await cancelNotification(taskData.datetime_notification_id);
    const { error: deleteError } = await supabase.from("tasks").delete().eq("id", taskData.id);
    setIsDeleting(false);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    deletedRef.current = true;
    navigation.goBack();
  }

  useLayoutEffect(() => {
    navigation.setOptions({
      title: taskData.type === "event" ? "Event" : "Task",
      headerBackTitle: "Back",
      headerRight: () => (
        <View style={styles.headerActions}>
          {saveStatus !== "idle" && (
            <Text style={styles.saveStatus}>{saveStatus === "saving" ? "Saving…" : "Saved"}</Text>
          )}
          <Pressable
            onPress={handleDelete}
            disabled={isDeleting}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Delete"
          >
            {isDeleting ? (
              <ActivityIndicator size="small" color={colors.danger} />
            ) : (
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
            )}
          </Pressable>
        </View>
      ),
      // eslint-disable-next-line react-hooks/exhaustive-deps
    });
  }, [navigation, isDeleting, taskData.id, taskData.title, taskData.type, saveStatus]);

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
    if (key === "when") {
      setDateDraft(parts.date || todayIso());
      setTimeDraft(parts.time || DEFAULT_TIME);
    } else if (key === "duration") {
      setDurationDraft(taskData.duration_minutes);
    }
  }

  // Writes one change and runs whatever it affects (reminders, travel time,
  // the title). Every control on the screen saves through here.
  async function saveField(key: string, patch: Record<string, unknown>): Promise<boolean> {
    setError(null);
    setSavingField(key);
    setSaveStatus("saving");
    if (savedTimer.current) clearTimeout(savedTimer.current);
    const previous = taskData;
    const { data, error: updateError } = await supabase
      .from("tasks")
      .update(patch)
      .eq("id", taskData.id)
      .select()
      .single();
    setSavingField(null);

    if (updateError) {
      setSaveStatus("idle");
      setError(updateError.message);
      return false;
    }
    setSaveStatus("saved");
    savedTimer.current = setTimeout(() => setSaveStatus("idle"), 1500);

    const updated = data as TaskRow;
    setTaskData(updated);
    closeField(key);

    if (key !== "title") {
      syncTitleIfNeeded(previous, updated);
    }
    if (key === "location" || key === "date") {
      maybeUpdateDeparture(updated);
    }
    // The reminder's text (title, location) and schedule (time, repeat rule) are
    // fixed when it's scheduled, so any of these means rescheduling it.
    if (key === "date" || key === "title" || key === "location" || key === "recurrence" || key === "notes") {
      maybeSyncDueNotification(updated);
    }
    // Notes appear in the "time to leave" reminder too. Its time doesn't
    // change, so it's just re-sent with the new text - no travel lookup.
    if (key === "notes") {
      maybeRefreshLeavingNotification(updated);
    }
    return true;
  }

  // Reschedules (or clears) the "at the scheduled time" notification in the
  // background after a manual date/time edit - independent of the location-
  // based "leaving by" one above, so it doesn't need a location at all. No
  // loading state or error surfaced here, same reasoning as syncTitleIfNeeded.
  async function maybeSyncDueNotification(task: TaskRow) {
    try {
      const updated = await syncDueNotification(task);
      setTaskData(updated);
    } catch {
      // Best-effort background recompute - ignore failures.
    }
  }
  async function maybeRefreshLeavingNotification(task: TaskRow) {
    try {
      const updated = await refreshLeavingNotification(task);
      setTaskData(updated);
    } catch {
      // Best-effort background refresh - ignore failures.
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
    } else if (updated.leaving_by_error) {
      // A retry that fails again would otherwise change nothing on screen, which
      // looks like the tap did nothing.
      setError("Still unable to calculate. The maps service may be having trouble - try again in a minute.");
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
      duration_minutes: t.duration_minutes,
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
    if (patch.duration_minutes !== undefined) dbPatch.duration_minutes = patch.duration_minutes;

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
    if (
      patch.datetime !== undefined ||
      patch.title !== undefined ||
      patch.location !== undefined ||
      patch.recurring !== undefined
    ) {
      maybeSyncDueNotification(updated);
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

  // --- Typed fields: saved when the user leaves them -----------------------

  function commitTitle() {
    const next = titleDraft.trim();
    if (!next) {
      setTitleDraft(taskData.title);
      return;
    }
    if (next !== taskData.title) saveField("title", { title: next });
  }

  function commitLocation() {
    const raw = locationDraft.trim();
    if (raw === (taskData.location_raw_text ?? "")) return;
    saveField("location", {
      location_raw_text: raw ? raw : null,
      location_place_type: raw ? taskData.location_place_type ?? "none" : null,
    });
  }

  function commitNotes() {
    const next = notesDraft.trim() || null;
    if (next !== taskData.notes) saveField("notes", { notes: next });
  }

  // Leaving the screen while still typing saves what was typed, the same as
  // tapping away from the field would. Skipped after a delete.
  const deletedRef = useRef(false);
  const commitAllRef = useRef(() => {});
  commitAllRef.current = () => {
    if (deletedRef.current) return;
    commitTitle();
    commitLocation();
    commitNotes();
  };
  useEffect(() => navigation.addListener("beforeRemove", () => commitAllRef.current()), [navigation]);

  // --- Choices: saved the moment one is tapped ------------------------------

  function chooseType(type: TaskType) {
    if (type !== taskData.type) saveField("type", { type });
  }

  function choosePriority(priority: Priority | typeof NO_PRIORITY) {
    const next = priority === NO_PRIORITY ? null : priority;
    if (next !== taskData.priority) saveField("priority", { priority: next });
  }

  function chooseDuration(minutes: number | null) {
    if (minutes !== taskData.duration_minutes) saveField("duration", { duration_minutes: minutes });
  }

  function chooseRepeat(choice: RecurringFrequency | typeof NO_RECURRENCE) {
    const frequency = choice === NO_RECURRENCE ? null : choice;
    if (frequency === taskData.recurring_frequency) return;
    // Keep the existing day(s) when they still mean something for the new
    // frequency; otherwise the date itself decides.
    const detail =
      frequency === "weekly" && parseWeekdays(taskData.recurring_detail).size > 0
        ? taskData.recurring_detail
        : frequency === "monthly" && parseDayOfMonth(taskData.recurring_detail)
          ? taskData.recurring_detail
          : null;
    saveField("recurrence", { recurring_frequency: frequency, recurring_detail: detail });
  }

  function toggleWeekday(day: number) {
    const current = weeklyDays(taskData.recurring_detail, taskData.datetime ? new Date(taskData.datetime) : null);
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
    // A weekly repeat needs at least one day.
    if (next.length === 0) return;
    saveField("recurrence", { recurring_detail: weeklyDetail(next) });
  }

  // --- Date & time ----------------------------------------------------------

  // One Save for both. Adding a date to an undated task deliberately doesn't
  // touch requires_downtime: a flexible task stays flexible (still in "When you
  // have time") even once it also has a reminder time.
  async function handleSaveWhen() {
    if (!dateDraft.trim()) {
      setError("Pick a date first.");
      return;
    }
    let datetime: string | null;
    try {
      datetime = datePartsToIso(dateDraft, timeDraft || DEFAULT_TIME);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid date or time.");
      return;
    }
    if (await saveField("date", { datetime, date_certainty: "exact" })) closeField("when");
  }

  // Back to "whenever": it then shows under "When you have time" on Today.
  async function handleRemoveDate() {
    if (await saveField("date", { datetime: null, date_certainty: "none", requires_downtime: true })) {
      closeField("when");
    }
  }

  const hasDate = Boolean(taskData.datetime);
  const anchor = taskData.datetime ? new Date(taskData.datetime) : null;
  const priorityValue = effectivePriority(taskData) ?? NO_PRIORITY;
  const durationIsPreset =
    taskData.duration_minutes === null || PRESET_MINUTES.includes(taskData.duration_minutes);
  const busy = (key: string) => savingField === key;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextInput
          style={styles.titleInput}
          value={titleDraft}
          onChangeText={setTitleDraft}
          onFocus={() => setFocusedField("title")}
          onBlur={() => {
            setFocusedField(null);
            commitTitle();
          }}
          onSubmitEditing={() => Keyboard.dismiss()}
          blurOnSubmit
          returnKeyType="done"
          multiline
          accessibilityLabel="Title"
        />
        <View style={styles.typeRow}>
          <SegmentedControl
            options={[
              { label: "Task", value: "task" as TaskType },
              { label: "Event", value: "event" as TaskType },
            ]}
            value={taskData.type}
            onChange={chooseType}
          />
        </View>

        <Text style={styles.sectionLabel}>When</Text>
        <View style={styles.card}>
          <FieldRow
            icon={hasDate ? "calendar-outline" : "alarm-outline"}
            label="Date & time"
            value={hasDate ? `${formatDateDisplay(taskData.datetime)} · ${formatTimeDisplay(taskData.datetime)}` : "None - tap to add"}
            valueColor={hasDate ? undefined : colors.accent}
            expanded={!!expanded.when}
            onToggle={() => toggleField("when")}
          >
            <DatePickerField value={dateDraft} onChange={setDateDraft} />
            <TimePickerField value={timeDraft} onChange={setTimeDraft} />
            <View style={styles.editorFooter}>
              <EditorActions onSave={handleSaveWhen} onCancel={() => closeField("when")} saving={busy("date")} />
              {hasDate && (
                <Pressable onPress={handleRemoveDate} disabled={busy("date")} hitSlop={8}>
                  <Text style={styles.removeLink}>Remove date</Text>
                </Pressable>
              )}
            </View>
          </FieldRow>

          {hasDate && (
            <ChoiceRow icon="hourglass-outline" label="Duration">
              <SegmentedControl
                compact
                options={[
                  { label: "None", value: "none" },
                  ...DURATION_PRESETS.map((m) => ({ label: formatDuration(m), value: String(m) })),
                  {
                    label: durationIsPreset ? "Other…" : formatDuration(taskData.duration_minutes!),
                    value: "other",
                  },
                ]}
                value={
                  expanded.duration || !durationIsPreset
                    ? "other"
                    : taskData.duration_minutes === null
                      ? "none"
                      : String(taskData.duration_minutes)
                }
                onChange={(choice) => {
                  if (choice === "other") {
                    toggleField("duration");
                    return;
                  }
                  closeField("duration");
                  chooseDuration(choice === "none" ? null : Number(choice));
                }}
              />
              {expanded.duration && (
                <View style={styles.subEditor}>
                  <DurationPicker value={durationDraft} onChange={setDurationDraft} />
                  <EditorActions
                    onSave={() => chooseDuration(durationDraft)}
                    onCancel={() => closeField("duration")}
                    saving={busy("duration")}
                  />
                </View>
              )}
            </ChoiceRow>
          )}

          <ChoiceRow
            icon="repeat-outline"
            label="Repeats"
            summary={taskData.recurring_frequency ? describeRecurrence(taskData.recurring_frequency, taskData.recurring_detail, anchor) : undefined}
            last
          >
            <SegmentedControl
              compact
              options={[
                { label: "Never", value: NO_RECURRENCE },
                { label: "Daily", value: "daily" as RecurringFrequency },
                { label: "Weekly", value: "weekly" as RecurringFrequency },
                { label: "Monthly", value: "monthly" as RecurringFrequency },
                { label: "Yearly", value: "yearly" as RecurringFrequency },
              ]}
              value={taskData.recurring_frequency ?? NO_RECURRENCE}
              onChange={chooseRepeat}
            />
            {taskData.recurring_frequency === "weekly" && (
              <View style={styles.weekdays}>
                {WEEK_ORDER.map((day) => {
                  const selected = weeklyDays(taskData.recurring_detail, anchor).includes(day);
                  return (
                    <Pressable
                      key={day}
                      onPress={() => toggleWeekday(day)}
                      disabled={busy("recurrence")}
                      style={[styles.weekday, selected && styles.weekdaySelected]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      accessibilityLabel={WEEKDAY_LABELS[day]}
                    >
                      <Text style={[styles.weekdayText, selected && styles.weekdayTextSelected]}>
                        {WEEKDAY_LABELS[day].charAt(0)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </ChoiceRow>
        </View>

        <Text style={styles.sectionLabel}>Where</Text>
        <View style={styles.card}>
          <View style={[styles.locationRow, (taskData.resolved_address || taskData.leaving_by || taskData.leaving_by_error || (taskData.location_raw_text && taskData.datetime)) && styles.rowBorder]}>
            <View style={styles.fieldIcon}>
              <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
            </View>
            <View style={styles.flex}>
              <TextInput
                style={styles.locationInput}
                value={locationDraft}
                onChangeText={setLocationDraft}
                onFocus={() => setFocusedField("location")}
                onBlur={() => {
                  setFocusedField(null);
                  commitLocation();
                }}
                onSubmitEditing={() => Keyboard.dismiss()}
                returnKeyType="done"
                placeholder="Add a place"
                placeholderTextColor={colors.textMuted}
                accessibilityLabel="Location"
              />
              {taskData.resolved_address && taskData.resolved_address !== taskData.location_raw_text && (
                <Text style={styles.resolvedAddress} numberOfLines={2}>
                  {taskData.resolved_address}
                </Text>
              )}
            </View>
            {taskData.location_raw_text && (
              <Pressable
                onPress={() => openInMaps(taskData.resolved_address ?? taskData.location_raw_text!)}
                style={styles.mapsButton}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Open in Maps"
              >
                <Ionicons name="navigate-outline" size={15} color={colors.accent} />
                <Text style={styles.mapsText}>Maps</Text>
              </Pressable>
            )}
          </View>

          {/* Shows only when a "leaving by" reminder was never even attempted -
              typically because location access wasn't available at save time,
              which fails silently there by design (see NewTaskScreen). */}
          {taskData.location_raw_text &&
            taskData.datetime &&
            !taskData.resolved_address &&
            !taskData.leaving_by &&
            !taskData.leaving_by_error && (
              <FieldRow
                icon="navigate-outline"
                iconColor={colors.accent}
                label="Leaving by"
                value={isSettingUpDeparture ? "Setting up…" : "Tap to set up a reminder"}
                valueColor={colors.accent}
                expanded={false}
                onToggle={handleSetupDeparture}
                readOnly={isSettingUpDeparture}
                bordered={false}
              />
            )}

          {(taskData.leaving_by || taskData.leaving_by_error) && (
            <FieldRow
              icon="navigate-outline"
              label="Leaving by"
              value={
                taskData.leaving_by_error
                  ? isSettingUpDeparture
                    ? "Retrying…"
                    : "Unable to calculate - tap to retry"
                  : formatTimeDisplay(taskData.leaving_by)
              }
              // The distance, starting point and directions go on their own
              // lines under the time, so a long route isn't cut off.
              details={taskData.leaving_by_error ? undefined : leavingByDetails(taskData)}
              valueLines={2}
              valueColor={taskData.leaving_by_error ? colors.warning : colors.accent}
              expanded={false}
              // A failed calculation can be retried by tapping the row; a
              // successful one is display-only, and so is the row mid-retry.
              onToggle={taskData.leaving_by_error ? handleSetupDeparture : () => {}}
              readOnly={!taskData.leaving_by_error || isSettingUpDeparture}
              bordered={false}
            />
          )}
        </View>

        <Text style={styles.sectionLabel}>Priority</Text>
        <SegmentedControl
          options={[
            // "None" is only meaningful for an event; for a task, no priority
            // simply means low, so Low is the way to say it.
            ...(taskData.type === "task" ? [] : [{ label: "None", value: NO_PRIORITY }]),
            { label: "Low", value: "low" as Priority },
            { label: "Normal", value: "normal" as Priority },
            { label: "High", value: "high" as Priority },
          ]}
          value={priorityValue}
          onChange={choosePriority}
        />

        <Text style={styles.sectionLabel}>Notes</Text>
        <TextInput
          style={styles.notesInput}
          value={notesDraft}
          onChangeText={setNotesDraft}
          onFocus={() => setFocusedField("notes")}
          onBlur={() => {
            setFocusedField(null);
            commitNotes();
          }}
          placeholder="Things to bring, a door code, anything to remember"
          placeholderTextColor={colors.textMuted}
          multiline
          textAlignVertical="top"
          accessibilityLabel="Notes"
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <Text style={styles.sectionLabel}>Ask AI</Text>
        <Text style={styles.askHint}>Describe a change in your own words, like "move it to Friday at 3".</Text>
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

// A detail edited by tapping a choice: icon and label on top (with an optional
// plain-words summary), the choices below.
function ChoiceRow({
  icon,
  label,
  summary,
  last = false,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  summary?: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.choiceRow, !last && styles.rowBorder]}>
      <View style={styles.choiceHeader}>
        <View style={styles.fieldIcon}>
          <Ionicons name={icon} size={16} color={colors.textSecondary} />
        </View>
        <Text style={styles.choiceLabel}>{label}</Text>
        {summary && (
          <Text style={styles.choiceSummary} numberOfLines={1}>
            {summary}
          </Text>
        )}
      </View>
      {children}
    </View>
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
  flex: {
    flex: 1,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  saveStatus: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  titleInput: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textPrimary,
    paddingVertical: 4,
    paddingHorizontal: 0,
  },
  typeRow: {
    marginTop: 10,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 24,
    marginBottom: 8,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
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
  fieldRowDetail: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    marginTop: 2,
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
  editorFooter: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  removeLink: {
    color: colors.danger,
    fontSize: 14,
  },
  subEditor: {
    marginTop: 12,
  },
  choiceRow: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 14,
  },
  choiceHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
  },
  choiceLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  choiceSummary: {
    flex: 1,
    textAlign: "right",
    fontSize: 13,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  weekdays: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
  },
  weekday: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  weekdaySelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  weekdayText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  weekdayTextSelected: {
    color: colors.onSurfaceInverse,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  locationInput: {
    fontSize: 16,
    fontWeight: "500",
    color: colors.textPrimary,
    paddingVertical: 6,
  },
  resolvedAddress: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  mapsButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.accentSoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  mapsText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: "600",
  },
  notesInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    minHeight: 96,
    fontSize: 15,
    lineHeight: 21,
    color: colors.textPrimary,
  },
  error: {
    color: colors.danger,
    marginTop: 12,
  },
  askHint: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 8,
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

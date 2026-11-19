import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { DurationPicker, EditorActions, FieldRow, SegmentedControl, fieldEditorStyles } from "./FieldEditorUI";
import DatePickerField from "./DatePickerField";
import TimePickerField from "./TimePickerField";
import { formatDuration } from "../lib/duration";
import { effectivePriority } from "../lib/priority";
import { colors } from "../lib/theme";
import type { ParsedTask, Priority, RecurringFrequency, TaskType } from "../types/task";

const NO_RECURRENCE = "none" as const;
const NO_PRIORITY = "none" as const;

// result.datetime is a naive local "YYYY-MM-DDTHH:mm:ss" string (the AI's own
// output format, not yet UTC-converted - that only happens at insert time in
// NewTaskScreen), so this works directly on the string rather than going
// through a Date object and risking a timezone round-trip.
function naiveIsoToDateParts(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return match ? { date: match[1], time: match[2] } : { date: "", time: "" };
}

function datePartsToNaiveIso(date: string, time: string): string | null {
  const trimmedDate = date.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) return null;
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time.trim());
  const hh = timeMatch ? timeMatch[1] : "00";
  const mm = timeMatch ? timeMatch[2] : "00";
  return `${trimmedDate}T${hh}:${mm}:00`;
}

function formatDateDisplay(iso: string | null): string {
  const { date } = naiveIsoToDateParts(iso);
  if (!date) return "Not set";
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatTimeDisplay(iso: string | null): string {
  const { time } = naiveIsoToDateParts(iso);
  if (!time) return "Not set";
  const [h, m] = time.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// What the "add a date & time" editor starts on.
const DEFAULT_REMINDER_TIME = "09:00";

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Field-by-field editor for a task the AI has just parsed but hasn't been
// saved yet - lets the user correct it before confirming, using the same
// expand/edit/Save UI as the real Edit Task screen, but every "Save" here
// just updates the in-memory ParsedTask via onChange rather than writing to
// the database (there's no row to write to until the user actually confirms).
export default function PendingTaskFields({
  task,
  onChange,
  hideTitle = false,
  locationSuggestions,
}: {
  task: ParsedTask;
  onChange: (updated: ParsedTask) => void;
  // The manual form has its own prominent title box, so it hides this row.
  hideTitle?: boolean;
  // The user's usual places, offered as one-tap choices in the location editor.
  locationSuggestions?: string[];
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const dateParts = naiveIsoToDateParts(task.datetime);

  const [titleDraft, setTitleDraft] = useState(task.title);
  const [typeDraft, setTypeDraft] = useState<TaskType>(task.type);
  const [dateDraft, setDateDraft] = useState(dateParts.date);
  const [timeDraft, setTimeDraft] = useState(dateParts.time);
  const [durationDraft, setDurationDraft] = useState<number | null>(task.duration_minutes);
  const [locationDraft, setLocationDraft] = useState(task.location?.raw_text ?? "");
  const [priorityDraft, setPriorityDraft] = useState<Priority | typeof NO_PRIORITY>(
    effectivePriority(task) ?? NO_PRIORITY
  );
  const [recurrenceFrequencyDraft, setRecurrenceFrequencyDraft] = useState<
    RecurringFrequency | typeof NO_RECURRENCE
  >(task.recurring?.frequency ?? NO_RECURRENCE);
  const [recurrenceDetailDraft, setRecurrenceDetailDraft] = useState(task.recurring?.interval_detail ?? "");

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
    const parts = naiveIsoToDateParts(task.datetime);
    switch (key) {
      case "title":
        setTitleDraft(task.title);
        break;
      case "type":
        setTypeDraft(task.type);
        break;
      case "reminder":
        setDateDraft(todayDateString());
        setTimeDraft(DEFAULT_REMINDER_TIME);
        break;
      case "date":
        setDateDraft(parts.date);
        break;
      case "time":
        setTimeDraft(parts.time);
        break;
      case "duration":
        setDurationDraft(task.duration_minutes);
        break;
      case "location":
        setLocationDraft(task.location?.raw_text ?? "");
        break;
      case "priority":
        setPriorityDraft(effectivePriority(task) ?? NO_PRIORITY);
        break;
      case "recurrence":
        setRecurrenceFrequencyDraft(task.recurring?.frequency ?? NO_RECURRENCE);
        setRecurrenceDetailDraft(task.recurring?.interval_detail ?? "");
        break;
    }
  }

  function handleSaveTitle() {
    if (!titleDraft.trim()) return;
    onChange({ ...task, title: titleDraft.trim() });
    closeField("title");
  }

  function handleSaveType() {
    onChange({ ...task, type: typeDraft });
    closeField("type");
  }

  // For a task with no date yet: gives it one, which also reveals the Date,
  // Time and Duration rows below (they only show once a date exists).
  function handleAddReminder() {
    const nextDatetime = datePartsToNaiveIso(dateDraft, timeDraft || DEFAULT_REMINDER_TIME);
    if (!nextDatetime) return;
    onChange({ ...task, datetime: nextDatetime, date_certainty: "exact" });
    closeField("reminder");
  }

  function handleSaveDate() {
    const nextDatetime = datePartsToNaiveIso(dateDraft, dateParts.time || "00:00");
    onChange({ ...task, datetime: nextDatetime, date_certainty: nextDatetime ? "exact" : "none" });
    closeField("date");
  }

  function handleSaveTime() {
    if (!dateParts.date) return;
    onChange({ ...task, datetime: datePartsToNaiveIso(dateParts.date, timeDraft) });
    closeField("time");
  }

  function handleSaveDuration() {
    onChange({ ...task, duration_minutes: durationDraft });
    closeField("duration");
  }

  function handleSaveLocation() {
    const raw = locationDraft.trim();
    onChange({
      ...task,
      location: raw ? { raw_text: raw, place_type: task.location?.place_type ?? "none" } : null,
    });
    closeField("location");
  }

  function handleSavePriority() {
    onChange({ ...task, priority: priorityDraft === NO_PRIORITY ? null : priorityDraft });
    closeField("priority");
  }

  function handleSaveRecurrence() {
    onChange({
      ...task,
      recurring:
        recurrenceFrequencyDraft === NO_RECURRENCE
          ? null
          : { frequency: recurrenceFrequencyDraft, interval_detail: recurrenceDetailDraft.trim() },
    });
    closeField("recurrence");
  }

  const showDateTimeRows = task.date_certainty !== "none";

  return (
    <View style={fieldEditorStyles.detailsCard}>
      {!hideTitle && (
        <FieldRow
          icon="create-outline"
          label="Title"
          value={task.title}
          expanded={!!expanded.title}
          onToggle={() => toggleField("title")}
        >
          <View style={fieldEditorStyles.inlineEditorRow}>
            <TextInput style={fieldEditorStyles.inlineInput} value={titleDraft} onChangeText={setTitleDraft} autoFocus />
          </View>
          <EditorActions onSave={handleSaveTitle} onCancel={() => closeField("title")} saving={false} />
        </FieldRow>
      )}

      <FieldRow
        icon="layers-outline"
        label="Type"
        value={capitalize(task.type)}
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
        <EditorActions onSave={handleSaveType} onCancel={() => closeField("type")} saving={false} />
      </FieldRow>

      {!showDateTimeRows && (
        <FieldRow
          icon="alarm-outline"
          label="Date & time"
          value="Not set - tap to add"
          valueColor={colors.accent}
          expanded={!!expanded.reminder}
          onToggle={() => toggleField("reminder")}
        >
          <DatePickerField value={dateDraft} onChange={setDateDraft} />
          <TimePickerField value={timeDraft} onChange={setTimeDraft} />
          <EditorActions onSave={handleAddReminder} onCancel={() => closeField("reminder")} saving={false} />
        </FieldRow>
      )}

      {showDateTimeRows && (
        <FieldRow
          icon="calendar-outline"
          label="Date"
          value={formatDateDisplay(task.datetime)}
          expanded={!!expanded.date}
          onToggle={() => toggleField("date")}
        >
          <DatePickerField value={dateDraft} onChange={setDateDraft} />
          <EditorActions onSave={handleSaveDate} onCancel={() => closeField("date")} saving={false} />
        </FieldRow>
      )}

      {showDateTimeRows && (
        <FieldRow
          icon="time-outline"
          label="Time"
          value={formatTimeDisplay(task.datetime)}
          expanded={!!expanded.time}
          onToggle={() => toggleField("time")}
        >
          <TimePickerField value={timeDraft} onChange={setTimeDraft} />
          <EditorActions onSave={handleSaveTime} onCancel={() => closeField("time")} saving={false} />
        </FieldRow>
      )}

      {showDateTimeRows && (
        <FieldRow
          icon="hourglass-outline"
          label="Duration"
          value={task.duration_minutes ? formatDuration(task.duration_minutes) : "Not set"}
          expanded={!!expanded.duration}
          onToggle={() => toggleField("duration")}
        >
          <DurationPicker value={durationDraft} onChange={setDurationDraft} />
          <EditorActions onSave={handleSaveDuration} onCancel={() => closeField("duration")} saving={false} />
        </FieldRow>
      )}

      <FieldRow
        icon="location-outline"
        label="Location"
        value={task.location?.raw_text || "Not set"}
        expanded={!!expanded.location}
        onToggle={() => toggleField("location")}
      >
        <View style={fieldEditorStyles.inlineEditorRow}>
          <TextInput
            style={fieldEditorStyles.inlineInput}
            value={locationDraft}
            onChangeText={setLocationDraft}
            placeholder="Where?"
            placeholderTextColor={colors.textMuted}
            autoFocus
          />
        </View>
        {locationSuggestions && locationSuggestions.length > 0 && (
          <View style={[fieldEditorStyles.segmentedControl, { marginTop: 10 }]}>
            {locationSuggestions.map((place) => {
              const selected = locationDraft === place;
              return (
                <Pressable
                  key={place}
                  onPress={() => setLocationDraft(place)}
                  style={[fieldEditorStyles.segment, selected && fieldEditorStyles.segmentSelected]}
                >
                  <Text style={[fieldEditorStyles.segmentText, selected && fieldEditorStyles.segmentTextSelected]}>
                    {place}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
        <EditorActions onSave={handleSaveLocation} onCancel={() => closeField("location")} saving={false} />
      </FieldRow>

      <FieldRow
        icon="flag-outline"
        label="Priority"
        value={effectivePriority(task) ? capitalize(effectivePriority(task)!) : "None"}
        expanded={!!expanded.priority}
        onToggle={() => toggleField("priority")}
      >
        <SegmentedControl
          options={[
            // "None" is only meaningful for an event; for a task, no priority
            // simply means low, so Low is the way to say it.
            ...(task.type === "task" ? [] : [{ label: "None", value: NO_PRIORITY }]),
            { label: "Low", value: "low" as Priority },
            { label: "Normal", value: "normal" as Priority },
            { label: "High", value: "high" as Priority },
          ]}
          value={priorityDraft}
          onChange={setPriorityDraft}
        />
        <EditorActions onSave={handleSavePriority} onCancel={() => closeField("priority")} saving={false} />
      </FieldRow>

      <FieldRow
        icon="repeat-outline"
        label="Recurrence"
        value={task.recurring ? capitalize(task.recurring.frequency) : "None"}
        expanded={!!expanded.recurrence}
        onToggle={() => toggleField("recurrence")}
        bordered={false}
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
            style={[fieldEditorStyles.inlineInput, fieldEditorStyles.recurrenceDetailInput]}
            value={recurrenceDetailDraft}
            onChangeText={setRecurrenceDetailDraft}
            placeholder="e.g. every other Tuesday"
            placeholderTextColor={colors.textMuted}
          />
        )}
        <EditorActions onSave={handleSaveRecurrence} onCancel={() => closeField("recurrence")} saving={false} />
      </FieldRow>
    </View>
  );
}

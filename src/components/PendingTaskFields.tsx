import { useState } from "react";
import { TextInput, View } from "react-native";
import { EditorActions, FieldRow, SegmentedControl, fieldEditorStyles } from "./FieldEditorUI";
import DatePickerField from "./DatePickerField";
import TimePickerField from "./TimePickerField";
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
}: {
  task: ParsedTask;
  onChange: (updated: ParsedTask) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const dateParts = naiveIsoToDateParts(task.datetime);

  const [titleDraft, setTitleDraft] = useState(task.title);
  const [typeDraft, setTypeDraft] = useState<TaskType>(task.type);
  const [dateDraft, setDateDraft] = useState(dateParts.date);
  const [timeDraft, setTimeDraft] = useState(dateParts.time);
  const [locationDraft, setLocationDraft] = useState(task.location?.raw_text ?? "");
  const [priorityDraft, setPriorityDraft] = useState<Priority | typeof NO_PRIORITY>(task.priority ?? NO_PRIORITY);
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
      case "date":
        setDateDraft(parts.date);
        break;
      case "time":
        setTimeDraft(parts.time);
        break;
      case "location":
        setLocationDraft(task.location?.raw_text ?? "");
        break;
      case "priority":
        setPriorityDraft(task.priority ?? NO_PRIORITY);
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
        <EditorActions onSave={handleSaveLocation} onCancel={() => closeField("location")} saving={false} />
      </FieldRow>

      <FieldRow
        icon="flag-outline"
        label="Priority"
        value={task.priority ? capitalize(task.priority) : "None"}
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

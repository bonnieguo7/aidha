import type { ParsedTask } from "../types/task";

// A blank task for the manual form: an undated task with just the defaults the
// AI would otherwise fill in. Priority stays null - a task with none counts as
// low (see effectivePriority).
export function createBlankTask(): ParsedTask {
  return {
    type: "task",
    title: "",
    datetime: null,
    date_certainty: "none",
    location: null,
    recurring: null,
    priority: null,
    requires_downtime: true,
    needs_clarification: [],
    confirmation_note: null,
    duration_minutes: null,
    notes: null,
  };
}

export function canSaveManualTask(task: ParsedTask): boolean {
  return task.title.trim().length > 0;
}

// Settles the fields the AI normally derives, so a hand-built task is saved the
// same way an AI-built one is: an exact date exists or it doesn't, and "whenever"
// (requires_downtime) follows mechanically from that, as it does in parse-task.
// A duration means nothing without a start time, so it's dropped without one.
export function finalizeManualTask(task: ParsedTask): ParsedTask {
  const hasDate = Boolean(task.datetime);
  return {
    ...task,
    title: task.title.trim(),
    date_certainty: hasDate ? "exact" : "none",
    requires_downtime: !hasDate,
    duration_minutes: hasDate ? task.duration_minutes : null,
    notes: task.notes?.trim() || null,
    needs_clarification: [],
    confirmation_note: null,
  };
}

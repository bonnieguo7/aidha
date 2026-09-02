export type TaskType = "event" | "task";
export type DateCertainty = "exact" | "approximate" | "none";
export type PlaceType = "specific_address" | "known_place" | "category" | "none";
export type RecurringFrequency = "daily" | "weekly" | "monthly" | "yearly";
export type Priority = "high" | "normal" | "low";
export type ClarificationField = "priority" | "datetime" | "location" | "recurrence";

// Shape returned by the parse-task Edge Function (mirrors the extract_task tool schema).
export interface ParsedTask {
  type: TaskType;
  title: string;
  datetime: string | null;
  date_certainty: DateCertainty;
  location: {
    raw_text: string;
    place_type: PlaceType;
  } | null;
  recurring: {
    frequency: RecurringFrequency;
    interval_detail: string;
  } | null;
  priority: Priority | null;
  requires_downtime: boolean;
  needs_clarification: ClarificationField[];
  confirmation_note: string | null;
}

// One turn in the parse-task conversation, sent to and echoed back by the Edge Function.
export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

// Shape returned by the parse-task Edge Function: a follow-up question (plain
// text reply expected), a multiple-choice question (tap one of `options`
// instead of typing - currently only used for priority), or the final result.
export type ParseTaskResponse =
  | { type: "question"; question: string }
  | { type: "choice"; question: string; field: "priority"; options: Priority[] }
  | { type: "result"; data: ParsedTask };

// Partial update returned by the edit-task Edge Function (mirrors the update_task tool
// schema). A key is only present when the user's instruction asked to change it; a
// present-but-null value means "clear this field."
export interface TaskPatch {
  type?: TaskType;
  title?: string;
  datetime?: string | null;
  date_certainty?: DateCertainty;
  location?: { raw_text: string; place_type: PlaceType } | null;
  recurring?: { frequency: RecurringFrequency; interval_detail: string } | null;
  priority?: Priority | null;
  requires_downtime?: boolean;
}

// Shape returned by the edit-task Edge Function: either a follow-up question or a patch to apply.
export type EditTaskResponse =
  | { type: "question"; question: string }
  | { type: "result"; data: TaskPatch };

// Row shape for the `tasks` table.
export interface TaskRow {
  id: string;
  user_id: string;
  raw_input: string;
  type: TaskType;
  title: string;
  datetime: string | null;
  date_certainty: DateCertainty;
  location_raw_text: string | null;
  location_place_type: PlaceType | null;
  recurring_frequency: RecurringFrequency | null;
  recurring_detail: string | null;
  priority: Priority | null;
  requires_downtime: boolean;
  is_completed: boolean;
  latitude: number | null;
  longitude: number | null;
  resolved_address: string | null;
  departure_origin_label: string | null;
  travel_duration_minutes: number | null;
  travel_directions_summary: string | null;
  leaving_by: string | null;
  leaving_notification_id: string | null;
  leaving_by_error: boolean;
  // Separate from leaving_notification_id: fires at the task/event's own
  // datetime (e.g. "pick up dry cleaning" firing at 10am), regardless of
  // whether there's a location to compute a "leaving by" reminder from.
  datetime_notification_id: string | null;
  created_at: string;
}

import type { Priority, TaskType } from "../types/task";

// What a task with no stored priority counts as. Tasks always get one now, but
// older rows (saved before Aidha asked) and any edit that clears it leave it
// null - and an unset priority means "not important enough to mention", so
// it's treated as low rather than as a separate unknown state.
export const DEFAULT_TASK_PRIORITY: Priority = "low";

// The priority to display and group by. Events have no priority at all (their
// fixed time already says how urgent they are), so theirs stays null.
export function effectivePriority(item: { type: TaskType; priority: Priority | null }): Priority | null {
  if (item.priority) return item.priority;
  return item.type === "task" ? DEFAULT_TASK_PRIORITY : null;
}

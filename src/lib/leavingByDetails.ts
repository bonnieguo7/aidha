import type { TaskRow } from "../types/task";

// The supporting lines shown under a task's "Leaving by" time: how far away it
// is, where the estimate starts from, and the directions summary ("Take the A
// then the L"). One line each, in that order, skipping whatever isn't known -
// they're separate lines so none of them gets cut off the way a single joined
// line did.
export function leavingByDetails(
  task: Pick<TaskRow, "travel_duration_minutes" | "departure_origin_label" | "travel_directions_summary">
): string[] {
  const lines: string[] = [];
  if (task.travel_duration_minutes != null) lines.push(`About ${task.travel_duration_minutes} min away`);
  if (task.departure_origin_label) lines.push(`From ${task.departure_origin_label}`);
  if (task.travel_directions_summary) lines.push(task.travel_directions_summary);
  return lines;
}

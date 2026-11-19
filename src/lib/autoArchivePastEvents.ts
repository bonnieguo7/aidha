import { createNextOccurrence } from "./completeTask";
import { itemEnd } from "./duration";
import { cancelNotification } from "./notifications";
import { supabase } from "./supabase";
import type { TaskRow } from "../types/task";

// Events represent a fixed moment the user had to be at - once that moment has
// passed there's nothing left to manually "complete," so unlike tasks they
// archive themselves automatically instead of waiting for a checkbox tap.
// There's no server-side cron in this app, so this runs as a lazy sweep
// whenever a screen loads its not-completed rows: any past, still-active
// event gets archived right then. Returns the same list with any just-
// archived events removed, so the caller's "active" view reflects it
// immediately without a second round-trip.
export async function archivePastEvents(rows: TaskRow[]): Promise<TaskRow[]> {
  const now = new Date();
  // "Past" means the event has ended, not just started: one with a duration
  // stays active (and shows as happening now) until its end, while one with no
  // duration ends the moment it starts, as every event did before durations.
  const pastEvents = rows.filter((t) => {
    if (t.type !== "event" || t.is_completed) return false;
    const end = itemEnd(t);
    return end !== null && end < now;
  });
  if (pastEvents.length === 0) return rows;

  await Promise.all(
    pastEvents.flatMap((t) => [cancelNotification(t.leaving_notification_id), cancelNotification(t.datetime_notification_id)])
  );

  // Only matches rows still active, and reports which it actually changed:
  // Today and the Tasks tab can both run this sweep on the same rows, and only
  // the one whose update lands should create a recurring event's next
  // occurrence (see completeTask for the same claim-before-create pattern).
  const { data: claimed, error } = await supabase
    .from("tasks")
    .update({ is_completed: true, leaving_notification_id: null, datetime_notification_id: null })
    .in(
      "id",
      pastEvents.map((t) => t.id)
    )
    .eq("is_completed", false)
    .select("id");

  // Best-effort - if the sweep write fails, leave the rows as loaded so
  // they're just swept again next time, rather than silently hiding them
  // from the active list while still incomplete in the database.
  if (error) return rows;

  // A repeating event (weekly yoga class) has nothing for the user to tick off
  // once it passes, so without this the series would silently end the first
  // time its date went by.
  const claimedIds = new Set((claimed ?? []).map((r: { id: string }) => r.id));
  const nextOccurrences: TaskRow[] = [];
  for (const event of pastEvents) {
    if (!claimedIds.has(event.id)) continue;
    const next = await createNextOccurrence(event);
    if (next) nextOccurrences.push(next);
  }

  const archivedIds = new Set(pastEvents.map((t) => t.id));
  return [...rows.filter((t) => !archivedIds.has(t.id)), ...nextOccurrences];
}

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
  const pastEvents = rows.filter(
    (t) => t.type === "event" && !t.is_completed && t.datetime && new Date(t.datetime) < now
  );
  if (pastEvents.length === 0) return rows;

  await Promise.all(pastEvents.map((t) => cancelNotification(t.leaving_notification_id)));

  const { error } = await supabase
    .from("tasks")
    .update({ is_completed: true, leaving_notification_id: null })
    .in(
      "id",
      pastEvents.map((t) => t.id)
    );

  // Best-effort - if the sweep write fails, leave the rows as loaded so
  // they're just swept again next time, rather than silently hiding them
  // from the active list while still incomplete in the database.
  if (error) return rows;

  const archivedIds = new Set(pastEvents.map((t) => t.id));
  return rows.filter((t) => !archivedIds.has(t.id));
}

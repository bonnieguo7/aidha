import type { Coords } from "./geocoding";
import { geocodeLocation } from "./geocoding";
import { reverseGeocodeLabel } from "./locationPermission";
import { cancelNotification, scheduleLeavingNotification } from "./notifications";
import { computeLeavingBy } from "./leavingBy";
import { supabase } from "./supabase";
import { getTravelDuration } from "./travelTime";
import type { TaskRow } from "../types/task";

const CLEARED_DEPARTURE_FIELDS = {
  latitude: null,
  longitude: null,
  resolved_address: null,
  departure_origin_label: null,
  travel_duration_minutes: null,
  travel_directions_summary: null,
  leaving_by: null,
  leaving_notification_id: null,
  leaving_by_error: false,
};

function hasDepartureData(task: TaskRow): boolean {
  return (
    task.latitude !== null ||
    task.longitude !== null ||
    task.resolved_address !== null ||
    task.departure_origin_label !== null ||
    task.travel_duration_minutes !== null ||
    task.travel_directions_summary !== null ||
    task.leaving_by !== null ||
    task.leaving_notification_id !== null ||
    task.leaving_by_error
  );
}

async function applyPatch(task: TaskRow, patch: Record<string, unknown>): Promise<TaskRow> {
  const { data, error } = await supabase.from("tasks").update(patch).eq("id", task.id).select().single();
  if (error || !data) {
    // Previously silent - a failed write here (e.g. a column the DB doesn't
    // have yet because a migration wasn't pushed) would just hand back the
    // unchanged task with zero indication anything went wrong. Logging it
    // makes that visible in Metro/device logs instead of a mystery revert.
    console.error("scheduleDeparture: failed to save departure fields", error);
    return task;
  }
  return data as TaskRow;
}

// Recomputes (or clears) a task's "leaving by" departure reminder: geocodes the
// location, estimates travel time, derives leavingBy, and (re)schedules the local
// notification - never leaving an orphaned one behind. Safe to call after any
// edit; it's a cheap no-op write when there's nothing to compute and nothing
// previously computed to clear.
export async function updateDepartureForTask(task: TaskRow, userLocation: Coords): Promise<TaskRow> {
  if (!task.location_raw_text || !task.datetime) {
    await cancelNotification(task.leaving_notification_id);
    if (!hasDepartureData(task)) return task;
    return applyPatch(task, CLEARED_DEPARTURE_FIELDS);
  }

  const destination = await geocodeLocation(task.location_raw_text, userLocation);
  if (!destination) {
    await cancelNotification(task.leaving_notification_id);
    return applyPatch(task, { ...CLEARED_DEPARTURE_FIELDS, leaving_by_error: true });
  }

  const eventTime = new Date(task.datetime);
  const travelResult = await getTravelDuration(userLocation, destination, eventTime);
  if (travelResult === null) {
    await cancelNotification(task.leaving_notification_id);
    return applyPatch(task, {
      latitude: destination.latitude,
      longitude: destination.longitude,
      resolved_address: destination.formattedAddress,
      travel_duration_minutes: null,
      travel_directions_summary: null,
      leaving_by: null,
      leaving_notification_id: null,
      leaving_by_error: true,
    });
  }

  const { durationMinutes: travelDurationMinutes, directionsSummary } = travelResult;
  const leavingBy = computeLeavingBy(eventTime, travelDurationMinutes);
  const originLabel = await reverseGeocodeLabel(userLocation);

  await cancelNotification(task.leaving_notification_id);
  const notificationId = await scheduleLeavingNotification(
    { ...task, travel_duration_minutes: travelDurationMinutes },
    leavingBy
  );

  return applyPatch(task, {
    latitude: destination.latitude,
    longitude: destination.longitude,
    resolved_address: destination.formattedAddress,
    departure_origin_label: originLabel,
    travel_duration_minutes: travelDurationMinutes,
    travel_directions_summary: directionsSummary,
    leaving_by: leavingBy.toISOString(),
    leaving_notification_id: notificationId,
    leaving_by_error: false,
  });
}

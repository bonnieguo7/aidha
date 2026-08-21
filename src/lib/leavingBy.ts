import { DEPARTURE_BUFFER_MINUTES } from "./constants";

// Pure function: eventTime minus (travel time + departure buffer). Deliberately
// does no clamping against "now" - a past result just means the event itself is
// in the past, which is the caller's problem (e.g. whether to still schedule a
// notification), not this function's.
export function computeLeavingBy(eventTime: Date, travelDurationMinutes: number): Date {
  const totalMinutes = travelDurationMinutes + DEPARTURE_BUFFER_MINUTES;
  return new Date(eventTime.getTime() - totalMinutes * 60_000);
}

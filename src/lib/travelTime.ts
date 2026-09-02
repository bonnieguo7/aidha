import type { Coords } from "./geocoding";
import { supabase } from "./supabase";
import { withTimeout } from "./withTimeout";

export type TravelMode = "transit" | "walking" | "driving";

export interface TravelResult {
  durationMinutes: number;
  // Short one-line "how to get there" (e.g. "Take the A then the L", "6 min
  // walk") - null when the Directions response didn't have enough to build one.
  directionsSummary: string | null;
}

const TRAVEL_TIME_TIMEOUT_MS = 10000;

// Travel duration (plus a short directions summary) from origin to
// destination, aiming to arrive by arrivalTime (honored for transit;
// walking/driving ignore it since duration doesn't depend on time of day in
// the same way). Returns null on any failure, including a timeout
// (supabase.functions.invoke has no timeout of its own, and neither does the
// edge function's own fetch to Google - either can hang) - the caller treats
// "no answer" as reason to show an error state, not a guess.
export async function getTravelDuration(
  origin: Coords,
  destination: Coords,
  arrivalTime: Date,
  mode: TravelMode = "transit"
): Promise<TravelResult | null> {
  try {
    const { data, error } = await withTimeout(
      supabase.functions.invoke("travel-time", {
        body: {
          origin,
          destination,
          arrival_time: arrivalTime.toISOString(),
          mode,
        },
      }),
      TRAVEL_TIME_TIMEOUT_MS
    );

    if (error) return null;
    if (!data?.found) return null;

    return { durationMinutes: data.duration_minutes, directionsSummary: data.directions_summary ?? null };
  } catch {
    return null;
  }
}

// Rough bounding box around Manhattan - a rectangle, not the island's actual
// shape, so it's approximate near the waterfront (could false-positive a
// Jersey City address just across the Hudson, or false-negative a Roosevelt
// Island address in the East River). Good enough for "which travel mode
// makes sense from here," not meant to be precise at the edges.
function isInManhattan(coords: Coords): boolean {
  return (
    coords.latitude >= 40.6997 &&
    coords.latitude <= 40.8790 &&
    coords.longitude >= -74.0194 &&
    coords.longitude <= -73.9067
  );
}

// Picks a travel mode instead of always using transit: always walk if it's
// under 20 minutes, otherwise take the train from Manhattan (dense subway
// coverage) or drive from anywhere else (transit is comparatively sparse
// outside Manhattan, so driving is the more realistic default).
export async function selectTravelRoute(
  origin: Coords,
  destination: Coords,
  arrivalTime: Date
): Promise<TravelResult | null> {
  const walking = await getTravelDuration(origin, destination, arrivalTime, "walking");

  if (walking && walking.durationMinutes < 20) {
    return walking;
  }

  const preferredMode: TravelMode = isInManhattan(origin) ? "transit" : "driving";
  const preferred = await getTravelDuration(origin, destination, arrivalTime, preferredMode);
  if (preferred) return preferred;

  // Preferred mode's request failed outright - fall back to the walking
  // result (even a long one) rather than nothing.
  return walking;
}

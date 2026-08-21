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

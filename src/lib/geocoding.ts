import { supabase } from "./supabase";
import { withTimeout } from "./withTimeout";

export interface Coords {
  latitude: number;
  longitude: number;
}

export interface GeocodeResult extends Coords {
  formattedAddress: string | null;
}

const GEOCODE_TIMEOUT_MS = 10000;

// Resolves a free-text location into coordinates (plus the resolved formatted
// address, for display) via the geocode Edge Function (Google Geocoding/Places
// APIs, server-side only - the API key never reaches the client). Passing `bias`
// (the user's current location) lets a chain/business name like "Equinox" resolve
// to the nearest branch instead of an arbitrary one.
// Returns null when the place can't be found, when the request itself fails, or
// when it times out (supabase.functions.invoke has no timeout of its own, and
// neither does the edge function's own fetch to Google - either can hang) -
// the caller only needs to distinguish "have coords" from "don't," not why.
export async function geocodeLocation(query: string, bias?: Coords): Promise<GeocodeResult | null> {
  try {
    const { data, error } = await withTimeout(
      supabase.functions.invoke("geocode", { body: bias ? { query, bias } : { query } }),
      GEOCODE_TIMEOUT_MS
    );

    if (error) return null;
    if (!data?.found) return null;

    return { latitude: data.latitude, longitude: data.longitude, formattedAddress: data.formattedAddress ?? null };
  } catch {
    return null;
  }
}

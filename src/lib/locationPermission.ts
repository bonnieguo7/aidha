import * as Location from "expo-location";
import type { Coords } from "./geocoding";
import { withTimeout } from "./withTimeout";

// getCurrentPositionAsync/reverseGeocodeAsync have no built-in timeout - without
// a GPS fix available (e.g. a simulator with no location set, or genuinely poor
// signal) they can hang indefinitely instead of rejecting, leaving any awaiting
// caller (like a "Setting up..." button) stuck forever with no error to show.
const LOCATION_TIMEOUT_MS = 10000;

// Requests foreground location permission (only at the point a task actually
// needs it - never at app launch, so the prompt always has context) and returns
// the user's current coordinates. Returns null if permission is denied, the
// position can't be read, or the request times out, so the caller can degrade
// gracefully instead of throwing or hanging.
export async function getCurrentUserLocation(): Promise<Coords | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return null;

    const position = await withTimeout(Location.getCurrentPositionAsync({}), LOCATION_TIMEOUT_MS);
    return { latitude: position.coords.latitude, longitude: position.coords.longitude };
  } catch {
    return null;
  }
}

// Turns coordinates into a short human-readable label (e.g. "123 Main St,
// Brooklyn") for displaying where a "leaving by" departure is calculated
// from. Uses the OS's on-device reverse geocoder (no Google API call, no
// extra cost) - returns null on any failure or timeout so the caller can just
// omit the "from" line rather than showing something broken.
export async function reverseGeocodeLabel(coords: Coords): Promise<string | null> {
  try {
    const [place] = await withTimeout(Location.reverseGeocodeAsync(coords), LOCATION_TIMEOUT_MS);
    if (!place) return null;

    const streetPart = [place.streetNumber, place.street].filter(Boolean).join(" ") || place.name || null;
    const parts = [streetPart, place.city].filter((p): p is string => Boolean(p));
    return parts.length > 0 ? parts.join(", ") : null;
  } catch {
    return null;
  }
}

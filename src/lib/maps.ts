import { Linking } from "react-native";

// Always opens Google Maps, never the OS-default Maps app (Apple Maps on iOS)
// - this is a Google-owned universal link, so it hands off to the native
// Google Maps app when installed and otherwise opens in the browser, but
// either way it's Google Maps. Pass the most precise string available for
// `query` (a full resolved street address, not a bare business name) - Apple
// and Google Maps both resolve a real address to the exact pin reliably, but
// a fuzzy name like "Barry's Wall Street" can land on a search results list
// instead of the specific location.
export function openInMaps(query: string) {
  const encoded = encodeURIComponent(query);
  const url = `https://www.google.com/maps/search/?api=1&query=${encoded}`;
  Linking.openURL(url).catch(() => {
    // Best-effort - nothing sensible to fall back to if even the web URL fails.
  });
}

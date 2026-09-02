// Fixed padding added on top of the raw travel-time estimate before it's used
// to compute a "leaving by" time - covers finding your keys, parking, etc.
export const DEPARTURE_BUFFER_MINUTES = 8;

// How close to an event's datetime a location/departure recheck kicks in on
// refresh (see refreshUpcomingDepartures) - checking further out than this
// wouldn't help, since there's no way to know where the user will be by
// then, and it'd just burn GPS/geocoding/directions calls for no benefit.
export const DEPARTURE_RECHECK_WINDOW_MINUTES = 90;

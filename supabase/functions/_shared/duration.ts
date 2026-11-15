const MIN_DURATION_MINUTES = 5;
const MAX_DURATION_MINUTES = 24 * 60;

// Parses the local wall-clock "YYYY-MM-DDTHH:mm:ss" format the model is asked
// to write datetimes in. Deliberately not `new Date(iso)`, which treats a
// string without a "Z"/offset inconsistently across JS engines.
function parseLocalIso(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(iso);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    second ? Number(second) : 0
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function toValidMinutes(value: number): number | null {
  const rounded = Math.round(value);
  return rounded >= MIN_DURATION_MINUTES && rounded <= MAX_DURATION_MINUTES ? rounded : null;
}

// Works out an event's length in minutes. The model supplies either a length it
// was told ("2 hours" -> 120) or an end time it was told ("until 8:30"), and
// the subtraction happens here in code - the same reason the booking-lead-time
// arithmetic does: exact clock math is easy for a model to get wrong by a few
// minutes. An explicit length wins; anything missing, backwards or outside
// 5 minutes to 24 hours becomes null, meaning "no duration".
export function resolveDurationMinutes(
  durationMinutes: number | null | undefined,
  startIso: string | null | undefined,
  endIso: string | null | undefined
): number | null {
  if (typeof durationMinutes === "number" && Number.isFinite(durationMinutes)) {
    const valid = toValidMinutes(durationMinutes);
    if (valid !== null) return valid;
  }

  if (!startIso || !endIso) return null;
  const start = parseLocalIso(startIso);
  const end = parseLocalIso(endIso);
  if (!start || !end || end <= start) return null;
  return toValidMinutes((end.getTime() - start.getTime()) / 60_000);
}

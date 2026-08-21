function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

// Local wall-clock time, formatted with no timezone suffix (e.g. "2026-07-31T14:30:00").
// Sent to parse-task so the model's date math happens in the same frame it's asked to answer in.
export function localIsoNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}`;
}

// Interprets a "YYYY-MM-DDTHH:mm[:ss]" value as local wall-clock time (ignoring any
// trailing "Z"/offset the model may have added anyway) and returns the correct UTC ISO
// instant for storage. Without this, a naive local time like "14:30" gets stored as if
// it were UTC and displays hours off once round-tripped through the database.
export function localNaiveToUtcIso(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (!match) return new Date(value).toISOString();

  const [, year, month, day, hour, minute, second] = match;
  const local = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    second ? Number(second) : 0
  );
  return local.toISOString();
}

// Inverse of localNaiveToUtcIso: formats a stored UTC ISO instant back into the
// local wall-clock string the AI edit endpoint expects, so it reasons about the
// task's current time in the same frame as the user's instruction.
export function isoToLocalNaive(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}`;
}

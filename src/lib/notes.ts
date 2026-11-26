const NOTES_PREVIEW_LENGTH = 100;

// A one-line preview of a task's notes for a notification, e.g. "Bathing suit,
// Sunscreen, Charger" from a list typed one item per line. List markers ("-",
// "*", "1.") are dropped, blank lines skipped, and long notes cut off with "…" -
// it's a reminder of what's in there, not the whole thing.
export function notesPreview(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const items = notes
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
  if (items.length === 0) return null;
  const text = items.join(", ");
  return text.length > NOTES_PREVIEW_LENGTH ? `${text.slice(0, NOTES_PREVIEW_LENGTH - 1).trimEnd()}…` : text;
}

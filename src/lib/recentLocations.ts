import { supabase } from "./supabase";

const MAX_LOCATION_SUGGESTIONS = 4;
const HISTORY_LIMIT = 200;
// Same cutoff the server applies to model-written suggestions - a full street
// address wraps into a paragraph on a chip.
const MAX_LABEL_LENGTH = 40;

interface LocationRow {
  location_raw_text: string | null;
}

// Ranks the places a user has used before into the few worth offering as
// one-tap answers to "where is it?". Places used at least twice come first
// (most-used, then most recent) since repeat visits are routine spots like a
// gym or an office; once-only places fill any remaining slots, newest first.
// `rows` must be newest first. Matching ignores case, and the spelling shown is
// the most recent one.
export function rankRecentLocations(rows: LocationRow[], limit = MAX_LOCATION_SUGGESTIONS): string[] {
  const stats = new Map<string, { label: string; count: number; newestIndex: number }>();

  rows.forEach((row, index) => {
    const label = row.location_raw_text?.trim();
    if (!label || label.length > MAX_LABEL_LENGTH) return;

    const key = label.toLowerCase();
    const existing = stats.get(key);
    if (existing) existing.count += 1;
    else stats.set(key, { label, count: 1, newestIndex: index });
  });

  return [...stats.values()]
    .sort((a, b) => {
      const repeatDiff = Number(b.count >= 2) - Number(a.count >= 2);
      if (repeatDiff !== 0) return repeatDiff;
      if (a.count >= 2 && b.count !== a.count) return b.count - a.count;
      return a.newestIndex - b.newestIndex;
    })
    .slice(0, limit)
    .map((entry) => entry.label);
}

// Runs on-device against the user's own saved tasks (row-level security scopes
// the query to them) - the locations are shown as chips locally and never sent
// to the AI model. Best-effort: any failure just means no location chips.
export async function fetchRecentLocations(): Promise<string[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("location_raw_text")
    .not("location_raw_text", "is", null)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (error || !data) return [];
  return rankRecentLocations(data);
}

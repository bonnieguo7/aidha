import { supabase } from "./supabase";
import type { HabitCheckin, HabitDraft, HabitRow } from "../types/habit";

// Supabase returns at most 1000 rows per request, so long histories are read a
// page at a time.
const PAGE = 1000;

export async function fetchHabits(): Promise<{ data: HabitRow[] | null; error: string | null }> {
  const { data, error } = await supabase
    .from("habits")
    .select("*")
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  return { data: (data as HabitRow[] | null) ?? null, error: error?.message ?? null };
}

// The user's check-ins at or after `since`, oldest first. Null on failure.
export async function fetchHabitCheckins(since: Date, habitId?: string): Promise<HabitCheckin[] | null> {
  const rows: HabitCheckin[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = supabase.from("habit_checkins").select("id, habit_id, completed_at").gte("completed_at", since.toISOString());
    if (habitId) query = query.eq("habit_id", habitId);
    const { data, error } = await query.order("completed_at", { ascending: true }).range(from, from + PAGE - 1);
    if (error) return null;
    rows.push(...((data ?? []) as HabitCheckin[]));
    if (!data || data.length < PAGE) return rows;
  }
}

export async function createHabit(draft: HabitDraft): Promise<{ data: HabitRow | null; error: string | null }> {
  const { data, error } = await supabase.from("habits").insert(draft).select().single();
  return { data: (data as HabitRow | null) ?? null, error: error?.message ?? null };
}

export async function updateHabit(
  id: string,
  patch: Partial<HabitDraft>
): Promise<{ data: HabitRow | null; error: string | null }> {
  const { data, error } = await supabase.from("habits").update(patch).eq("id", id).select().single();
  return { data: (data as HabitRow | null) ?? null, error: error?.message ?? null };
}

// Hides the habit everywhere; its check-ins stay, so they keep counting on the Profile.
export async function archiveHabit(id: string): Promise<string | null> {
  const { error } = await supabase.from("habits").update({ archived_at: new Date().toISOString() }).eq("id", id);
  return error?.message ?? null;
}

// `at` defaults to now; a past moment checks the habit off for an earlier day.
export async function addCheckin(
  habitId: string,
  at: Date = new Date()
): Promise<{ data: HabitCheckin | null; error: string | null }> {
  const { data, error } = await supabase
    .from("habit_checkins")
    .insert({ habit_id: habitId, completed_at: at.toISOString() })
    .select("id, habit_id, completed_at")
    .single();
  return { data: (data as HabitCheckin | null) ?? null, error: error?.message ?? null };
}

export async function removeCheckin(id: string): Promise<string | null> {
  const { error } = await supabase.from("habit_checkins").delete().eq("id", id);
  return error?.message ?? null;
}

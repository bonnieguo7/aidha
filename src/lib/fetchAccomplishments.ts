import { fetchHabitCheckins } from "./habitsApi";
import { supabase } from "./supabase";
import type { HabitRow } from "../types/habit";
import type { TaskRow } from "../types/task";

// When each of the signed-in user's completed tasks and habit check-ins
// happened, for those at or after `since`. Events never count. Null if either
// query fails.
export async function fetchCompletionTimes(since: Date): Promise<string[] | null> {
  const [tasks, checkins] = await Promise.all([
    supabase
      .from("tasks")
      .select("completed_at")
      .eq("type", "task")
      .eq("is_completed", true)
      .gte("completed_at", since.toISOString()),
    fetchHabitCheckins(since),
  ]);
  if (tasks.error || !checkins) return null;
  return [
    ...(tasks.data ?? []).map((row: { completed_at: string }) => row.completed_at),
    ...checkins.map((c) => c.completed_at),
  ];
}

// How many completed tasks have no completion time - ones finished before the
// app started recording it - so the profile can say why they aren't charted.
export async function countUndatedCompletions(): Promise<number | null> {
  const { count, error } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("type", "task")
    .eq("is_completed", true)
    .is("completed_at", null);
  if (error) return null;
  return count ?? 0;
}

// One thing the user got done: a task they checked off, or one check-in of a habit.
export type CompletedItem =
  | { kind: "task"; id: string; title: string; completed_at: string; task: TaskRow }
  | { kind: "habit"; id: string; title: string; completed_at: string; habit: HabitRow };

// Everything the user got done in [start, end), most recent first. Null if
// either query fails.
export async function fetchCompletedItems(start: Date, end: Date): Promise<CompletedItem[] | null> {
  const [tasks, checkins] = await Promise.all([
    supabase
      .from("tasks")
      .select("*")
      .eq("type", "task")
      .eq("is_completed", true)
      .gte("completed_at", start.toISOString())
      .lt("completed_at", end.toISOString())
      .order("completed_at", { ascending: false }),
    supabase
      .from("habit_checkins")
      .select("id, completed_at, habit:habits(*)")
      .gte("completed_at", start.toISOString())
      .lt("completed_at", end.toISOString())
      .order("completed_at", { ascending: false }),
  ]);
  if (tasks.error || checkins.error) return null;

  const items: CompletedItem[] = [
    ...((tasks.data ?? []) as TaskRow[]).map((task) => ({
      kind: "task" as const,
      id: task.id,
      title: task.title,
      completed_at: task.completed_at!,
      task,
    })),
    ...((checkins.data ?? []) as unknown as { id: string; completed_at: string; habit: HabitRow | null }[])
      .filter((c) => c.habit)
      .map((c) => ({ kind: "habit" as const, id: c.id, title: c.habit!.title, completed_at: c.completed_at, habit: c.habit! })),
  ];
  return items.sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1));
}

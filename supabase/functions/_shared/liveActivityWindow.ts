// How far ahead of a task's "leaving by" time the server starts its Live Activity.
export const LOOKAHEAD_MINUTES = 15;
// A leaving-by that has just passed still qualifies, so a check that runs a few
// seconds late (or a task whose time is recalculated to "right now") isn't missed.
export const GRACE_MINUTES = 1;

// The range of leaving_by times that are due a Live Activity at `nowMs`: from a
// minute ago up to 15 minutes ahead. The earlier rule was exactly 14-15 minutes
// ahead - a one-minute window, so a task whose time landed inside it (created or
// edited close to departure) or was recalculated after it passed never got one.
// Starting any time in the last 15 minutes is safe because each task is stamped
// once started (live_activity_started_at) and is never picked up twice.
export function liveActivityWindow(nowMs: number): { from: string; to: string } {
  return {
    from: new Date(nowMs - GRACE_MINUTES * 60_000).toISOString(),
    to: new Date(nowMs + LOOKAHEAD_MINUTES * 60_000).toISOString(),
  };
}

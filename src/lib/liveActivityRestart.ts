// The start-live-activities server job starts a Live Activity once a task's
// leaving_by is within 15 minutes, but only for tasks not already stamped with
// live_activity_started_at. Nothing else clears that stamp, so without this a
// task rescheduled after its Live Activity started would never get another.

// A new leaving_by must be at least this far ahead to be worth clearing the
// stamp: the server starts one for anything within 15 minutes, so clearing the
// stamp for a time already inside that range would immediately start a second
// activity on top of the one already showing. The extra minute is a safety margin.
export const RESTART_MIN_LEAD_MINUTES = 16;
// Small recalculations (the user's location drifting a few hundred metres) must
// not restart anything - only a real move of the time does.
export const RESTART_MIN_SHIFT_MINUTES = 5;

export function shouldRestartLiveActivity(args: {
  startedAt: string | null;
  previousLeavingBy: string | null;
  newLeavingBy: Date;
  now?: Date;
}): boolean {
  // Never started, so there's nothing to clear.
  if (!args.startedAt) return false;

  const now = args.now ?? new Date();
  if (args.newLeavingBy.getTime() - now.getTime() < RESTART_MIN_LEAD_MINUTES * 60_000) return false;

  if (!args.previousLeavingBy) return true;
  const previous = new Date(args.previousLeavingBy);
  if (Number.isNaN(previous.getTime())) return true;
  return Math.abs(args.newLeavingBy.getTime() - previous.getTime()) >= RESTART_MIN_SHIFT_MINUTES * 60_000;
}

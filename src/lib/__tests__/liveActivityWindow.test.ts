import { GRACE_MINUTES, LOOKAHEAD_MINUTES, liveActivityWindow } from "../../../supabase/functions/_shared/liveActivityWindow";
import { RESTART_MIN_LEAD_MINUTES } from "../liveActivityRestart";

const NOW = new Date("2026-11-23T18:00:00Z").getTime();
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();
const inWindow = (leavingByMinutes: number) => {
  const { from, to } = liveActivityWindow(NOW);
  const t = at(leavingByMinutes);
  return t >= from && t <= to;
};

describe("liveActivityWindow", () => {
  it("spans from a minute ago to 15 minutes ahead", () => {
    expect(liveActivityWindow(NOW)).toEqual({ from: at(-1), to: at(15) });
    expect(GRACE_MINUTES).toBe(1);
    expect(LOOKAHEAD_MINUTES).toBe(15);
  });

  it("catches a task whose leaving-by is anywhere in the next 15 minutes", () => {
    // The old rule only caught 14-15; a task created or recalculated closer than
    // that was never started.
    for (const minutes of [0, 1, 5, 10, 14, 14.5, 15]) expect(inWindow(minutes)).toBe(true);
  });

  it("still catches a leaving-by that has only just passed", () => {
    expect(inWindow(-0.5)).toBe(true);
    expect(inWindow(-1)).toBe(true);
  });

  it("ignores a time further out than 15 minutes, or long past", () => {
    expect(inWindow(15.1)).toBe(false);
    expect(inWindow(60)).toBe(false);
    expect(inWindow(-1.1)).toBe(false);
    expect(inWindow(-30)).toBe(false);
  });

  it("agrees with the app's restart rule: a time the app would restart is outside the window", () => {
    // Clearing the "started" stamp is only done for a leaving-by at least
    // RESTART_MIN_LEAD_MINUTES ahead. If that were inside the window, the server
    // would start a second Live Activity straight away.
    expect(RESTART_MIN_LEAD_MINUTES).toBeGreaterThan(LOOKAHEAD_MINUTES);
    expect(inWindow(RESTART_MIN_LEAD_MINUTES)).toBe(false);
  });
});

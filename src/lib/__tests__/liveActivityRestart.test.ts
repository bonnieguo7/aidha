import {
  RESTART_MIN_LEAD_MINUTES,
  RESTART_MIN_SHIFT_MINUTES,
  shouldRestartLiveActivity,
} from "../liveActivityRestart";

const now = new Date("2026-11-20T17:00:00");
const inMinutes = (m: number) => new Date(now.getTime() + m * 60_000);
const STARTED = "2026-11-20T16:45:00.000Z";

describe("shouldRestartLiveActivity", () => {
  it("restarts when a started task is moved well out of range", () => {
    // Started for a 17:15 leave-by; moved to 19:30.
    expect(
      shouldRestartLiveActivity({
        startedAt: STARTED,
        previousLeavingBy: inMinutes(15).toISOString(),
        newLeavingBy: inMinutes(150),
        now,
      })
    ).toBe(true);
  });

  it("does nothing for a task whose Live Activity never started", () => {
    expect(
      shouldRestartLiveActivity({ startedAt: null, previousLeavingBy: null, newLeavingBy: inMinutes(150), now })
    ).toBe(false);
  });

  it("does nothing when the new time is already inside (or right at) the server's window", () => {
    // A second activity would start on top of the one already showing.
    for (const minutes of [-5, 5, 14, 15, RESTART_MIN_LEAD_MINUTES - 1]) {
      expect(
        shouldRestartLiveActivity({
          startedAt: STARTED,
          previousLeavingBy: inMinutes(60).toISOString(),
          newLeavingBy: inMinutes(minutes),
          now,
        })
      ).toBe(false);
    }
  });

  it("restarts once the new time is comfortably beyond the window", () => {
    expect(
      shouldRestartLiveActivity({
        startedAt: STARTED,
        previousLeavingBy: inMinutes(60).toISOString(),
        newLeavingBy: inMinutes(RESTART_MIN_LEAD_MINUTES),
        now,
      })
    ).toBe(true);
  });

  it("ignores a small recalculation", () => {
    const previous = inMinutes(90);
    for (const shift of [-4, -1, 0, 1, RESTART_MIN_SHIFT_MINUTES - 1]) {
      expect(
        shouldRestartLiveActivity({
          startedAt: STARTED,
          previousLeavingBy: previous.toISOString(),
          newLeavingBy: new Date(previous.getTime() + shift * 60_000),
          now,
        })
      ).toBe(false);
    }
  });

  it("restarts for a shift of exactly the minimum, in either direction", () => {
    const previous = inMinutes(90);
    for (const shift of [-RESTART_MIN_SHIFT_MINUTES, RESTART_MIN_SHIFT_MINUTES]) {
      expect(
        shouldRestartLiveActivity({
          startedAt: STARTED,
          previousLeavingBy: previous.toISOString(),
          newLeavingBy: new Date(previous.getTime() + shift * 60_000),
          now,
        })
      ).toBe(true);
    }
  });

  it("restarts when there's no usable previous time to compare against", () => {
    expect(
      shouldRestartLiveActivity({ startedAt: STARTED, previousLeavingBy: null, newLeavingBy: inMinutes(120), now })
    ).toBe(true);
    expect(
      shouldRestartLiveActivity({ startedAt: STARTED, previousLeavingBy: "garbage", newLeavingBy: inMinutes(120), now })
    ).toBe(true);
  });
});

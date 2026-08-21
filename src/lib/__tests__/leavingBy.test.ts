import { DEPARTURE_BUFFER_MINUTES } from "../constants";
import { computeLeavingBy } from "../leavingBy";

describe("computeLeavingBy", () => {
  it("subtracts travel time plus the departure buffer from the event time", () => {
    const eventTime = new Date("2026-08-04T20:00:00");
    const result = computeLeavingBy(eventTime, 20);
    expect(result).toEqual(new Date("2026-08-04T19:32:00"));
  });

  it("subtracts only the buffer when travel duration is zero", () => {
    const eventTime = new Date("2026-08-04T20:00:00");
    const result = computeLeavingBy(eventTime, 0);
    expect(result).toEqual(new Date(eventTime.getTime() - DEPARTURE_BUFFER_MINUTES * 60_000));
  });

  it("handles long travel durations spanning multiple hours", () => {
    const eventTime = new Date("2026-08-04T20:00:00");
    const result = computeLeavingBy(eventTime, 150);
    expect(result).toEqual(new Date("2026-08-04T17:22:00"));
  });

  it("returns a time in the past without clamping when the event itself is already in the past", () => {
    const pastEventTime = new Date("2020-01-01T09:00:00");
    const result = computeLeavingBy(pastEventTime, 15);
    expect(result.getTime()).toBeLessThan(pastEventTime.getTime());
    expect(result).toEqual(new Date("2020-01-01T08:37:00"));
  });

  it("is a pure function - same inputs always produce the same output", () => {
    const eventTime = new Date("2026-08-04T20:00:00");
    const first = computeLeavingBy(eventTime, 45);
    const second = computeLeavingBy(eventTime, 45);
    expect(first).toEqual(second);
    expect(eventTime).toEqual(new Date("2026-08-04T20:00:00"));
  });
});

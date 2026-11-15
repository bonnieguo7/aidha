import {
  eventEnd,
  formatDuration,
  isInProgress,
  parseDurationInput,
} from "../duration";
import { resolveDurationMinutes } from "../../../supabase/functions/_shared/duration";

const at = (s: string) => new Date(s);
const event = (start: string, duration: number | null) => ({
  type: "event" as const,
  datetime: at(start).toISOString(),
  duration_minutes: duration,
});

describe("formatDuration", () => {
  it.each([
    [30, "30 min"],
    [45, "45 min"],
    [60, "1 hr"],
    [90, "1 hr 30 min"],
    [120, "2 hr"],
    [135, "2 hr 15 min"],
  ])("%i minutes -> %s", (minutes, text) => {
    expect(formatDuration(minutes)).toBe(text);
  });
});

describe("parseDurationInput", () => {
  it("accepts whole minutes, with or without a unit", () => {
    expect(parseDurationInput("90")).toBe(90);
    expect(parseDurationInput(" 45 min ")).toBe(45);
    expect(parseDurationInput("30 Minutes")).toBe(30);
  });

  it("rejects non-numbers, decimals and out-of-range values", () => {
    expect(parseDurationInput("")).toBeNull();
    expect(parseDurationInput("abc")).toBeNull();
    expect(parseDurationInput("1.5")).toBeNull();
    expect(parseDurationInput("2 hours")).toBeNull();
    expect(parseDurationInput("4")).toBeNull();
    expect(parseDurationInput("1441")).toBeNull();
  });

  it("accepts the bounds", () => {
    expect(parseDurationInput("5")).toBe(5);
    expect(parseDurationInput("1440")).toBe(1440);
  });
});

describe("eventEnd", () => {
  it("adds the duration to an event's start", () => {
    expect(eventEnd(event("2026-11-14T19:00:00", 90))).toEqual(at("2026-11-14T20:30:00"));
  });

  it("ends an event with no duration the moment it starts", () => {
    expect(eventEnd(event("2026-11-14T19:00:00", null))).toEqual(at("2026-11-14T19:00:00"));
  });

  it("ignores a duration on a task", () => {
    const task = { ...event("2026-11-14T19:00:00", 90), type: "task" as const };
    expect(eventEnd(task)).toEqual(at("2026-11-14T19:00:00"));
  });

  it("is null with no datetime", () => {
    expect(eventEnd({ type: "event", datetime: null, duration_minutes: 60 })).toBeNull();
  });
});

describe("isInProgress", () => {
  const e = event("2026-11-14T19:00:00", 60);

  it("is false before the start, true during, false from the end on", () => {
    expect(isInProgress(e, at("2026-11-14T18:59:00"))).toBe(false);
    expect(isInProgress(e, at("2026-11-14T19:00:00"))).toBe(true);
    expect(isInProgress(e, at("2026-11-14T19:59:00"))).toBe(true);
    expect(isInProgress(e, at("2026-11-14T20:00:00"))).toBe(false);
  });

  it("is never true for an event without a duration", () => {
    expect(isInProgress(event("2026-11-14T19:00:00", null), at("2026-11-14T19:00:00"))).toBe(false);
  });
});

describe("resolveDurationMinutes", () => {
  const start = "2026-11-14T17:00:00";

  it("uses an explicit length", () => {
    expect(resolveDurationMinutes(120, start, null)).toBe(120);
  });

  it("computes the length from an end time in code", () => {
    expect(resolveDurationMinutes(null, start, "2026-11-14T18:30:00")).toBe(90);
    expect(resolveDurationMinutes(undefined, "2026-11-14T17:00", "2026-11-14T17:45")).toBe(45);
  });

  it("prefers an explicit length over an end time", () => {
    expect(resolveDurationMinutes(60, start, "2026-11-14T19:00:00")).toBe(60);
  });

  it("falls back to the end time when the explicit length is unusable", () => {
    expect(resolveDurationMinutes(2, start, "2026-11-14T18:00:00")).toBe(60);
  });

  it("returns null with nothing usable", () => {
    expect(resolveDurationMinutes(null, start, null)).toBeNull();
    expect(resolveDurationMinutes(null, null, "2026-11-14T18:00:00")).toBeNull();
    expect(resolveDurationMinutes(undefined, undefined, undefined)).toBeNull();
  });

  it("rejects an end time at or before the start", () => {
    expect(resolveDurationMinutes(null, start, "2026-11-14T17:00:00")).toBeNull();
    expect(resolveDurationMinutes(null, start, "2026-11-14T16:00:00")).toBeNull();
  });

  it("rejects lengths outside 5 minutes to 24 hours", () => {
    expect(resolveDurationMinutes(4, start, null)).toBeNull();
    expect(resolveDurationMinutes(1441, start, null)).toBeNull();
    expect(resolveDurationMinutes(5, start, null)).toBe(5);
    expect(resolveDurationMinutes(1440, start, null)).toBe(1440);
  });

  it("rejects garbage datetimes", () => {
    expect(resolveDurationMinutes(null, "tomorrow", "later")).toBeNull();
  });

  it("rounds a fractional length", () => {
    expect(resolveDurationMinutes(89.6, start, null)).toBe(90);
  });
});

import { computeNextOccurrence } from "../recurrence";

// All dates are local wall-clock (no "Z"), matching how the function works.
// Nov 9 2026 is a Monday, Nov 13 a Friday.
const d = (s: string) => new Date(s);

describe("computeNextOccurrence - daily", () => {
  it("returns the next day at the same time when completed on schedule", () => {
    const next = computeNextOccurrence("daily", null, d("2026-11-13T08:00:00"), d("2026-11-13T08:05:00"));
    expect(next).toEqual(d("2026-11-14T08:00:00"));
  });

  it("does not schedule the same occurrence again when completed early", () => {
    const next = computeNextOccurrence("daily", null, d("2026-11-13T20:00:00"), d("2026-11-13T07:00:00"));
    expect(next).toEqual(d("2026-11-14T20:00:00"));
  });

  it("skips ahead to the next future occurrence when completed days late", () => {
    const next = computeNextOccurrence("daily", null, d("2026-11-10T08:00:00"), d("2026-11-13T21:00:00"));
    expect(next).toEqual(d("2026-11-14T08:00:00"));
  });

  it("keeps today's occurrence when an overdue instance is completed before today's time", () => {
    const next = computeNextOccurrence("daily", null, d("2026-11-12T08:00:00"), d("2026-11-13T07:00:00"));
    expect(next).toEqual(d("2026-11-13T08:00:00"));
  });

  it("rolls over month and year boundaries", () => {
    const next = computeNextOccurrence("daily", null, d("2026-12-31T08:00:00"), d("2026-12-31T09:00:00"));
    expect(next).toEqual(d("2027-01-01T08:00:00"));
  });
});

describe("computeNextOccurrence - weekly", () => {
  it("uses the weekday named in the detail", () => {
    const next = computeNextOccurrence(
      "weekly",
      "day_of_week:monday",
      d("2026-11-09T18:00:00"),
      d("2026-11-09T19:00:00")
    );
    expect(next).toEqual(d("2026-11-16T18:00:00"));
  });

  it("jumps to the next named weekday when completed late", () => {
    const next = computeNextOccurrence(
      "weekly",
      "day_of_week:monday",
      d("2026-11-09T18:00:00"),
      d("2026-11-13T10:00:00")
    );
    expect(next).toEqual(d("2026-11-16T18:00:00"));
  });

  it("picks the earliest upcoming day from a multi-day list", () => {
    const next = computeNextOccurrence(
      "weekly",
      "day_of_week:monday,thursday",
      d("2026-11-09T18:00:00"),
      d("2026-11-09T19:00:00")
    );
    expect(next).toEqual(d("2026-11-12T18:00:00"));
  });

  it("falls back to the anchor's own weekday when the detail is empty or unparseable", () => {
    const anchor = d("2026-11-11T12:00:00"); // Wednesday
    expect(computeNextOccurrence("weekly", null, anchor, d("2026-11-11T13:00:00"))).toEqual(
      d("2026-11-18T12:00:00")
    );
    expect(computeNextOccurrence("weekly", "every other whenever", anchor, d("2026-11-11T13:00:00"))).toEqual(
      d("2026-11-18T12:00:00")
    );
  });

  it("does not repeat the same week when completed early", () => {
    const next = computeNextOccurrence(
      "weekly",
      "day_of_week:monday",
      d("2026-11-16T18:00:00"),
      d("2026-11-13T10:00:00")
    );
    expect(next).toEqual(d("2026-11-23T18:00:00"));
  });
});

describe("computeNextOccurrence - monthly", () => {
  it("uses day_of_month from the detail", () => {
    const next = computeNextOccurrence(
      "monthly",
      "day_of_month:1",
      d("2026-11-01T09:00:00"),
      d("2026-11-01T10:00:00")
    );
    expect(next).toEqual(d("2026-12-01T09:00:00"));
  });

  it("clamps the 31st to the last day of shorter months", () => {
    const next = computeNextOccurrence(
      "monthly",
      "day_of_month:31",
      d("2026-01-31T09:00:00"),
      d("2026-01-31T10:00:00")
    );
    expect(next).toEqual(d("2026-02-28T09:00:00"));
  });

  it("returns to the 31st after a clamped month", () => {
    const next = computeNextOccurrence(
      "monthly",
      "day_of_month:31",
      d("2026-02-28T09:00:00"),
      d("2026-02-28T10:00:00")
    );
    expect(next).toEqual(d("2026-03-31T09:00:00"));
  });

  it("rolls over the year boundary", () => {
    const next = computeNextOccurrence(
      "monthly",
      "day_of_month:15",
      d("2026-12-15T09:00:00"),
      d("2026-12-15T10:00:00")
    );
    expect(next).toEqual(d("2027-01-15T09:00:00"));
  });

  it("falls back to the anchor's day of month without a detail", () => {
    const next = computeNextOccurrence("monthly", null, d("2026-11-20T09:00:00"), d("2026-11-20T10:00:00"));
    expect(next).toEqual(d("2026-12-20T09:00:00"));
  });
});

describe("computeNextOccurrence - yearly", () => {
  it("returns the same date next year", () => {
    const next = computeNextOccurrence("yearly", null, d("2026-11-13T09:00:00"), d("2026-11-13T10:00:00"));
    expect(next).toEqual(d("2027-11-13T09:00:00"));
  });

  it("lands Feb 29 birthdays on Feb 28 in non-leap years", () => {
    const next = computeNextOccurrence("yearly", null, d("2028-02-29T09:00:00"), d("2028-02-29T10:00:00"));
    expect(next).toEqual(d("2029-02-28T09:00:00"));
  });
});

describe("computeNextOccurrence - no anchor (a 'whenever' task)", () => {
  const now = d("2026-11-13T07:00:00");

  it("defaults to 9am on a later calendar day for daily tasks", () => {
    expect(computeNextOccurrence("daily", null, null, now)).toEqual(d("2026-11-14T09:00:00"));
  });

  it("uses the named weekday at 9am for weekly tasks", () => {
    expect(computeNextOccurrence("weekly", "day_of_week:monday", null, now)).toEqual(d("2026-11-16T09:00:00"));
  });

  it("falls back to today's weekday, a week out, with no detail", () => {
    expect(computeNextOccurrence("weekly", null, null, now)).toEqual(d("2026-11-20T09:00:00"));
  });
});

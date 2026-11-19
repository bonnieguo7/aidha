import { canSaveManualTask, createBlankTask, finalizeManualTask } from "../manualTask";

describe("createBlankTask", () => {
  it("is an undated, untitled task", () => {
    expect(createBlankTask()).toMatchObject({
      type: "task",
      title: "",
      datetime: null,
      date_certainty: "none",
      location: null,
      recurring: null,
      priority: null,
      duration_minutes: null,
    });
  });

  it("returns a fresh object each time", () => {
    expect(createBlankTask()).not.toBe(createBlankTask());
  });
});

describe("canSaveManualTask", () => {
  it("needs a non-blank title", () => {
    expect(canSaveManualTask({ ...createBlankTask(), title: "" })).toBe(false);
    expect(canSaveManualTask({ ...createBlankTask(), title: "   " })).toBe(false);
    expect(canSaveManualTask({ ...createBlankTask(), title: "Pay rent" })).toBe(true);
  });
});

describe("finalizeManualTask", () => {
  it("trims the title", () => {
    expect(finalizeManualTask({ ...createBlankTask(), title: "  Pay rent  " }).title).toBe("Pay rent");
  });

  it("marks an undated task as 'whenever' with no deadline", () => {
    const done = finalizeManualTask({ ...createBlankTask(), title: "x" });
    expect(done.date_certainty).toBe("none");
    expect(done.requires_downtime).toBe(true);
  });

  it("marks a dated task exact and not 'whenever'", () => {
    const done = finalizeManualTask({ ...createBlankTask(), title: "x", datetime: "2026-11-20T09:00:00" });
    expect(done.date_certainty).toBe("exact");
    expect(done.requires_downtime).toBe(false);
  });

  it("keeps a duration only when there is a start time", () => {
    const withDate = finalizeManualTask({ ...createBlankTask(), title: "x", datetime: "2026-11-20T09:00:00", duration_minutes: 90 });
    const without = finalizeManualTask({ ...createBlankTask(), title: "x", duration_minutes: 90 });
    expect(withDate.duration_minutes).toBe(90);
    expect(without.duration_minutes).toBeNull();
  });

  it("keeps the fields the user set", () => {
    const done = finalizeManualTask({
      ...createBlankTask(),
      title: "Dentist",
      type: "event",
      datetime: "2026-11-20T15:00:00",
      location: { raw_text: "Midtown Dental", place_type: "none" },
      priority: "high",
      recurring: { frequency: "weekly", interval_detail: "day_of_week:friday" },
    });
    expect(done).toMatchObject({
      type: "event",
      location: { raw_text: "Midtown Dental" },
      priority: "high",
      recurring: { frequency: "weekly" },
    });
  });

  it("clears AI-only fields", () => {
    const done = finalizeManualTask({ ...createBlankTask(), title: "x", needs_clarification: ["priority"], confirmation_note: "hi" });
    expect(done.needs_clarification).toEqual([]);
    expect(done.confirmation_note).toBeNull();
  });
});

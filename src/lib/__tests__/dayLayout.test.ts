import {
  blockGeometry,
  buildDayBlocks,
  dayMinutes,
  getDayBounds,
  layoutBlocks,
  MINUTES_PER_DAY,
  type DayBlock,
} from "../dayLayout";
import type { TaskRow } from "../../types/task";

const day = getDayBounds(new Date("2026-11-14T12:00:00"));

function makeTask(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "t1",
    user_id: "u1",
    raw_input: "",
    type: "event",
    title: "Dinner",
    datetime: new Date("2026-11-14T19:00:00").toISOString(),
    date_certainty: "exact",
    location_raw_text: null,
    location_place_type: null,
    recurring_frequency: null,
    recurring_detail: null,
    priority: null,
    requires_downtime: false,
    duration_minutes: null,
    is_completed: false,
    latitude: null,
    longitude: null,
    resolved_address: null,
    departure_origin_label: null,
    travel_duration_minutes: null,
    travel_directions_summary: null,
    leaving_by: null,
    leaving_notification_id: null,
    leaving_by_error: false,
    live_activity_started_at: null,
    datetime_notification_id: null,
    created_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

function span(id: string, start: number, end: number): DayBlock {
  return { id, kind: "event", task: makeTask({ id }), startMinutes: start, endMinutes: end };
}

describe("getDayBounds / dayMinutes", () => {
  it("returns local midnight to the next local midnight", () => {
    expect(day.start).toEqual(new Date("2026-11-14T00:00:00"));
    expect(day.end).toEqual(new Date("2026-11-15T00:00:00"));
  });

  it("measures clock minutes past midnight", () => {
    expect(dayMinutes(new Date("2026-11-14T00:00:00"), day.start, day.end)).toBe(0);
    expect(dayMinutes(new Date("2026-11-14T16:13:00"), day.start, day.end)).toBe(16 * 60 + 13);
  });

  it("clamps moments outside the day to its edges", () => {
    expect(dayMinutes(new Date("2026-11-13T23:00:00"), day.start, day.end)).toBe(0);
    expect(dayMinutes(new Date("2026-11-15T01:00:00"), day.start, day.end)).toBe(MINUTES_PER_DAY);
  });
});

describe("buildDayBlocks", () => {
  it("gives an event an hour and a task half an hour", () => {
    const blocks = buildDayBlocks(
      [
        makeTask({ id: "e", type: "event", datetime: new Date("2026-11-14T10:00:00").toISOString() }),
        makeTask({ id: "t", type: "task", datetime: new Date("2026-11-14T14:00:00").toISOString() }),
      ],
      day.start,
      day.end
    );
    expect(blocks.map((b) => [b.id, b.kind, b.startMinutes, b.endMinutes])).toEqual([
      ["e", "event", 600, 660],
      ["t", "task", 840, 870],
    ]);
  });

  it("uses an event's own duration instead of the default hour", () => {
    const blocks = buildDayBlocks(
      [
        makeTask({ id: "short", datetime: new Date("2026-11-14T09:00:00").toISOString(), duration_minutes: 30 }),
        makeTask({ id: "long", datetime: new Date("2026-11-14T13:00:00").toISOString(), duration_minutes: 150 }),
        makeTask({ id: "unset", datetime: new Date("2026-11-14T18:00:00").toISOString(), duration_minutes: null }),
      ],
      day.start,
      day.end
    );
    expect(blocks.map((b) => [b.id, b.endMinutes - b.startMinutes])).toEqual([
      ["short", 30],
      ["long", 150],
      ["unset", 60],
    ]);
  });

  it("uses a task's own duration, and half an hour when it has none", () => {
    const blocks = buildDayBlocks(
      [
        makeTask({ id: "timed", type: "task", datetime: new Date("2026-11-14T09:00:00").toISOString(), duration_minutes: 120 }),
        makeTask({ id: "plain", type: "task", datetime: new Date("2026-11-14T14:00:00").toISOString(), duration_minutes: null }),
      ],
      day.start,
      day.end
    );
    expect(blocks.map((b) => [b.id, b.endMinutes - b.startMinutes])).toEqual([
      ["timed", 120],
      ["plain", 30],
    ]);
  });

  it("clips a long event at midnight", () => {
    const blocks = buildDayBlocks(
      [makeTask({ datetime: new Date("2026-11-14T22:00:00").toISOString(), duration_minutes: 240 })],
      day.start,
      day.end
    );
    expect(blocks[0].endMinutes).toBe(MINUTES_PER_DAY);
  });

  it("skips tasks with no time or outside the day", () => {
    const blocks = buildDayBlocks(
      [
        makeTask({ id: "none", datetime: null }),
        makeTask({ id: "yesterday", datetime: new Date("2026-11-13T23:59:00").toISOString() }),
        makeTask({ id: "tomorrow", datetime: new Date("2026-11-15T00:00:00").toISOString() }),
        makeTask({ id: "today", datetime: new Date("2026-11-14T08:00:00").toISOString() }),
      ],
      day.start,
      day.end
    );
    expect(blocks.map((b) => b.id)).toEqual(["today"]);
  });

  it("adds a leave-by block that ends where the event starts", () => {
    const blocks = buildDayBlocks(
      [
        makeTask({
          datetime: new Date("2026-11-14T20:00:00").toISOString(),
          leaving_by: new Date("2026-11-14T19:32:00").toISOString(),
        }),
      ],
      day.start,
      day.end
    );
    const travel = blocks.find((b) => b.kind === "travel")!;
    expect([travel.startMinutes, travel.endMinutes]).toEqual([19 * 60 + 32, 20 * 60]);
    expect(travel.id).toBe("t1:travel");
  });

  it("keeps a very short leave-by block tall enough to see, without ending before the event starts", () => {
    const blocks = buildDayBlocks(
      [
        makeTask({
          datetime: new Date("2026-11-14T20:00:00").toISOString(),
          leaving_by: new Date("2026-11-14T19:55:00").toISOString(),
        }),
      ],
      day.start,
      day.end
    );
    const travel = blocks.find((b) => b.kind === "travel")!;
    expect(travel.endMinutes - travel.startMinutes).toBe(15);
  });

  it("omits the leave-by block for a completed event", () => {
    const blocks = buildDayBlocks(
      [
        makeTask({
          is_completed: true,
          datetime: new Date("2026-11-14T09:00:00").toISOString(),
          leaving_by: new Date("2026-11-14T08:30:00").toISOString(),
        }),
      ],
      day.start,
      day.end
    );
    expect(blocks.map((b) => b.kind)).toEqual(["event"]);
  });

  it("clips a leave-by block that began the previous evening to midnight", () => {
    const blocks = buildDayBlocks(
      [
        makeTask({
          datetime: new Date("2026-11-14T00:20:00").toISOString(),
          leaving_by: new Date("2026-11-13T23:50:00").toISOString(),
        }),
      ],
      day.start,
      day.end
    );
    const travel = blocks.find((b) => b.kind === "travel")!;
    expect(travel.startMinutes).toBe(0);
  });

  it("ends an event at midnight instead of running past the grid", () => {
    const blocks = buildDayBlocks(
      [makeTask({ datetime: new Date("2026-11-14T23:30:00").toISOString() })],
      day.start,
      day.end
    );
    expect(blocks[0].endMinutes).toBe(MINUTES_PER_DAY);
  });
});

describe("layoutBlocks", () => {
  const cols = (blocks: DayBlock[]) =>
    Object.fromEntries(layoutBlocks(blocks).map((b) => [b.id, [b.column, b.columnCount]]));

  it("gives a lone block the full width", () => {
    expect(cols([span("a", 60, 120)])).toEqual({ a: [0, 1] });
  });

  it("puts overlapping blocks side by side", () => {
    expect(cols([span("a", 60, 120), span("b", 90, 150)])).toEqual({ a: [0, 2], b: [1, 2] });
  });

  it("does not treat blocks that merely touch as overlapping", () => {
    expect(cols([span("a", 60, 120), span("b", 120, 180)])).toEqual({ a: [0, 1], b: [0, 1] });
  });

  it("reuses a freed column within a chain of overlaps", () => {
    // a overlaps b, b overlaps c, but a and c don't overlap - c can sit under a.
    expect(cols([span("a", 60, 120), span("b", 90, 150), span("c", 130, 190)])).toEqual({
      a: [0, 2],
      b: [1, 2],
      c: [0, 2],
    });
  });

  it("gives three simultaneous blocks three columns", () => {
    expect(cols([span("a", 60, 120), span("b", 60, 120), span("c", 60, 120)])).toEqual({
      a: [0, 3],
      b: [1, 3],
      c: [2, 3],
    });
  });

  it("keeps separate clusters independent", () => {
    expect(cols([span("a", 60, 120), span("b", 90, 150), span("c", 300, 360)])).toEqual({
      a: [0, 2],
      b: [1, 2],
      c: [0, 1],
    });
  });

  it("lays out regardless of input order", () => {
    expect(cols([span("b", 90, 150), span("a", 60, 120)])).toEqual({ a: [0, 2], b: [1, 2] });
  });

  it("returns nothing for no blocks", () => {
    expect(layoutBlocks([])).toEqual([]);
  });
});

describe("blockGeometry", () => {
  it("converts minutes to pixels and splits the width by column", () => {
    const [positioned] = layoutBlocks([span("a", 60, 120)]);
    expect(blockGeometry(positioned, 1, 300)).toEqual({ top: 60, height: 58, left: 0, width: 298 });
  });

  it("offsets the second column and halves the width", () => {
    const blocks = layoutBlocks([span("a", 60, 120), span("b", 90, 150)]);
    const b = blocks.find((x) => x.id === "b")!;
    expect(blockGeometry(b, 1, 300)).toEqual({ top: 90, height: 58, left: 150, width: 148 });
  });
});

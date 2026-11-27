import { countUndatedCompletions, fetchCompletedItems, fetchCompletionTimes } from "../fetchAccomplishments";

// Each query records its table and filters; results are set per table/kind.
type Query = { table: string; select: [string, unknown]; filters: [string, string, unknown][] };
const mockQueries: Query[] = [];
let mockCount: { count: number | null; error: unknown } = { count: 0, error: null };
let mockRows: Record<string, { data: unknown; error: unknown }> = {};

jest.mock("../supabase", () => ({
  supabase: {
    from: (table: string) => {
      const query: Query = { table, select: ["", undefined], filters: [] };
      mockQueries.push(query);
      const chain: Record<string, unknown> = {
        select: (cols: string, opts?: unknown) => {
          query.select = [cols, opts];
          return chain;
        },
        ...Object.fromEntries(
          ["eq", "gte", "lt", "is", "order", "range"].map((op) => [
            op,
            (col: string, value: unknown) => {
              query.filters.push([op, col, value]);
              return chain;
            },
          ])
        ),
        then: (resolve: (v: unknown) => void) =>
          resolve(
            (query.select[1] as { head?: boolean } | undefined)?.head
              ? mockCount
              : (mockRows[table] ?? { data: [], error: null })
          ),
      };
      return chain;
    },
  },
}));

beforeEach(() => {
  mockQueries.length = 0;
  mockCount = { count: 0, error: null };
  mockRows = {};
});

const filtersOf = (table: string) => mockQueries.find((q) => q.table === table)!.filters;

describe("fetchCompletionTimes", () => {
  const since = new Date("2026-06-01T00:00:00");

  it("asks for completed tasks - never events - and habit check-ins since the given moment", async () => {
    await fetchCompletionTimes(since);
    expect(filtersOf("tasks")).toEqual(
      expect.arrayContaining([
        ["eq", "type", "task"],
        ["eq", "is_completed", true],
        ["gte", "completed_at", since.toISOString()],
      ])
    );
    expect(filtersOf("habit_checkins")).toContainEqual(["gte", "completed_at", since.toISOString()]);
  });

  it("returns task and habit times together", async () => {
    mockRows.tasks = { data: [{ completed_at: "2026-11-26T09:00:00.000Z" }], error: null };
    mockRows.habit_checkins = { data: [{ id: "c1", habit_id: "h1", completed_at: "2026-11-25T09:00:00.000Z" }], error: null };
    expect(await fetchCompletionTimes(since)).toEqual(["2026-11-26T09:00:00.000Z", "2026-11-25T09:00:00.000Z"]);
  });

  it("returns null when either query fails", async () => {
    mockRows.habit_checkins = { data: null, error: { message: "boom" } };
    expect(await fetchCompletionTimes(since)).toBeNull();
  });
});

describe("countUndatedCompletions", () => {
  it("counts completed tasks that have no completion time", async () => {
    mockCount = { count: 36, error: null };
    expect(await countUndatedCompletions()).toBe(36);
    expect(mockQueries[0].filters).toEqual(
      expect.arrayContaining([
        ["eq", "type", "task"],
        ["eq", "is_completed", true],
        ["is", "completed_at", null],
      ])
    );
  });

  it("returns null when the query fails", async () => {
    mockCount = { count: null, error: { message: "boom" } };
    expect(await countUndatedCompletions()).toBeNull();
  });
});

describe("fetchCompletedItems", () => {
  const start = new Date("2026-11-23T00:00:00");
  const end = new Date("2026-11-30T00:00:00");

  it("limits both queries to the period, and tasks to completed tasks", async () => {
    await fetchCompletedItems(start, end);
    for (const table of ["tasks", "habit_checkins"]) {
      expect(filtersOf(table)).toEqual(
        expect.arrayContaining([
          ["gte", "completed_at", start.toISOString()],
          ["lt", "completed_at", end.toISOString()],
        ])
      );
    }
    expect(filtersOf("tasks")).toEqual(expect.arrayContaining([["eq", "type", "task"], ["eq", "is_completed", true]]));
  });

  it("merges tasks and habit check-ins, newest first", async () => {
    mockRows.tasks = { data: [{ id: "t1", title: "Pay rent", completed_at: "2026-11-26T10:00:00.000Z" }], error: null };
    mockRows.habit_checkins = {
      data: [
        { id: "c1", completed_at: "2026-11-26T12:00:00.000Z", habit: { id: "h1", title: "Clean room" } },
        { id: "c2", completed_at: "2026-11-24T12:00:00.000Z", habit: { id: "h1", title: "Clean room" } },
      ],
      error: null,
    };
    const items = await fetchCompletedItems(start, end);
    expect(items!.map((i) => [i.kind, i.title])).toEqual([
      ["habit", "Clean room"],
      ["task", "Pay rent"],
      ["habit", "Clean room"],
    ]);
  });

  it("returns null when either query fails", async () => {
    mockRows.tasks = { data: null, error: { message: "boom" } };
    expect(await fetchCompletedItems(start, end)).toBeNull();
  });
});

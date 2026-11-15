import { completeTask } from "../completeTask";
import type { TaskRow } from "../../types/task";

const mockUpdateSelect = jest.fn();
const mockInsertSingle = jest.fn();
const mockInsert = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    from: () => ({
      update: () => ({ eq: () => ({ eq: () => ({ select: mockUpdateSelect }) }) }),
      insert: (row: unknown) => {
        mockInsert(row);
        return { select: () => ({ single: mockInsertSingle }) };
      },
    }),
  },
}));
jest.mock("../notifications", () => ({ cancelNotification: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../syncDueNotification", () => ({ syncDueNotification: jest.fn(async (t: unknown) => t) }));
jest.mock("../locationPermission", () => ({ getCurrentUserLocation: jest.fn().mockResolvedValue(null) }));
jest.mock("../scheduleDeparture", () => ({ updateDepartureForTask: jest.fn(async (t: unknown) => t) }));

function makeTask(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "task-1",
    user_id: "user-1",
    raw_input: "water plants every monday",
    type: "task",
    title: "Water plants",
    datetime: "2026-11-09T14:00:00.000Z",
    date_certainty: "exact",
    location_raw_text: null,
    location_place_type: null,
    recurring_frequency: "weekly",
    recurring_detail: "day_of_week:monday",
    priority: "normal",
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
    datetime_notification_id: null,
    created_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockInsertSingle.mockImplementation(async () => ({
    data: { ...makeTask({ id: "task-2" }), ...(mockInsert.mock.calls.at(-1)?.[0] as object) },
    error: null,
  }));
});

describe("completeTask", () => {
  it("creates the next occurrence for a recurring task it actually completed", async () => {
    mockUpdateSelect.mockResolvedValue({ data: [{ id: "task-1" }], error: null });

    const result = await completeTask(makeTask());

    expect(result.error).toBeNull();
    expect(result.next).not.toBeNull();
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const inserted = mockInsert.mock.calls[0][0];
    expect(inserted).toMatchObject({
      user_id: "user-1",
      title: "Water plants",
      recurring_frequency: "weekly",
      recurring_detail: "day_of_week:monday",
      date_certainty: "exact",
    });
    expect(new Date(inserted.datetime).getTime()).toBeGreaterThan(Date.now());
  });

  it("does not create a duplicate when another caller already completed the task", async () => {
    mockUpdateSelect.mockResolvedValue({ data: [], error: null });

    const result = await completeTask(makeTask());

    expect(result).toEqual({ next: null, error: null });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("creates nothing for a non-recurring task", async () => {
    mockUpdateSelect.mockResolvedValue({ data: [{ id: "task-1" }], error: null });

    const result = await completeTask(makeTask({ recurring_frequency: null, recurring_detail: null }));

    expect(result).toEqual({ next: null, error: null });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("surfaces an update error and creates nothing", async () => {
    mockUpdateSelect.mockResolvedValue({ data: null, error: { message: "boom" } });

    const result = await completeTask(makeTask());

    expect(result).toEqual({ next: null, error: "boom" });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("still reports the completion as successful if inserting the next instance fails", async () => {
    mockUpdateSelect.mockResolvedValue({ data: [{ id: "task-1" }], error: null });
    mockInsertSingle.mockResolvedValue({ data: null, error: { message: "insert failed" } });
    jest.spyOn(console, "error").mockImplementation(() => {});

    const result = await completeTask(makeTask());

    expect(result).toEqual({ next: null, error: null });
  });
});

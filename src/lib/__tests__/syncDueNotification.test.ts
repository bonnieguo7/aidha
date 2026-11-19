import { recurringMarker } from "../notifications";
import { syncDueNotification } from "../syncDueNotification";
import type { TaskRow } from "../../types/task";

let mockStored: TaskRow;
jest.mock("../supabase", () => ({
  supabase: {
    from: () => ({
      update: (patch: Record<string, unknown>) => ({
        eq: () => ({
          select: () => ({
            single: async () => {
              mockStored = { ...mockStored, ...patch } as TaskRow;
              return { data: mockStored, error: null };
            },
          }),
        }),
      }),
    }),
  },
}));

const mockSchedule = jest.fn();
const mockCancel = jest.fn();
jest.mock("../notifications", () => {
  const actual = jest.requireActual("../notifications");
  return {
    ...actual,
    scheduleDueNotification: (...args: unknown[]) => mockSchedule(...args),
    cancelNotification: (...args: unknown[]) => mockCancel(...args),
  };
});

function makeTask(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "task-1",
    title: "Water plants",
    datetime: new Date(Date.now() + 3600_000).toISOString(),
    is_completed: false,
    datetime_notification_id: null,
    recurring_frequency: null,
    ...overrides,
  } as unknown as TaskRow;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("syncDueNotification", () => {
  it("stores the recurring marker on a repeating task, replacing its old one-time reminder", async () => {
    const task = makeTask({ recurring_frequency: "weekly", datetime_notification_id: "legacy-one-shot-id" });
    mockStored = task;
    mockSchedule.mockResolvedValue(recurringMarker("task-1"));

    const updated = await syncDueNotification(task);

    expect(mockCancel).toHaveBeenCalledWith("legacy-one-shot-id");
    expect(updated.datetime_notification_id).toBe("recurring:task-1");
  });

  it("cancels the repeating reminder (via its marker) when the item is completed", async () => {
    const task = makeTask({
      recurring_frequency: "weekly",
      is_completed: true,
      datetime_notification_id: recurringMarker("task-1"),
    });
    mockStored = task;

    const updated = await syncDueNotification(task);

    expect(mockCancel).toHaveBeenCalledWith("recurring:task-1");
    expect(mockSchedule).not.toHaveBeenCalled();
    expect(updated.datetime_notification_id).toBeNull();
  });

  it("clears the stored marker when a repeating task stops repeating, and schedules a one-time reminder", async () => {
    const task = makeTask({ recurring_frequency: null, datetime_notification_id: recurringMarker("task-1") });
    mockStored = task;
    mockSchedule.mockResolvedValue("one-shot-id");

    const updated = await syncDueNotification(task);

    expect(mockCancel).toHaveBeenCalledWith("recurring:task-1");
    expect(updated.datetime_notification_id).toBe("one-shot-id");
  });
});

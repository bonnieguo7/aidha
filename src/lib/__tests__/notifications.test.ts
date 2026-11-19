import {
  cancelNotification,
  getScheduledRecurringMarkers,
  recurringMarker,
  scheduleDueNotification,
} from "../notifications";
import type { TaskRow } from "../../types/task";

const mockSchedule = jest.fn();
const mockCancel = jest.fn();
const mockGetAll = jest.fn();
const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();

jest.mock("expo-notifications", () => ({
  SchedulableTriggerInputTypes: {
    DATE: "date",
    DAILY: "daily",
    WEEKLY: "weekly",
    MONTHLY: "monthly",
    YEARLY: "yearly",
  },
  scheduleNotificationAsync: (...args: unknown[]) => mockSchedule(...args),
  cancelScheduledNotificationAsync: (...args: unknown[]) => mockCancel(...args),
  getAllScheduledNotificationsAsync: (...args: unknown[]) => mockGetAll(...args),
  getPermissionsAsync: (...args: unknown[]) => mockGetPermissions(...args),
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissions(...args),
}));

const inHours = (h: number) => new Date(Date.now() + h * 3600_000);

function makeTask(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "task-1",
    title: "Water plants",
    location_raw_text: null,
    datetime: inHours(5).toISOString(),
    recurring_frequency: null,
    recurring_detail: null,
    ...overrides,
  } as unknown as TaskRow;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPermissions.mockResolvedValue({ status: "granted" });
  mockRequestPermissions.mockResolvedValue({ status: "granted" });
  mockSchedule.mockImplementation(async (request: { identifier?: string }) => request.identifier ?? "generated-id");
  mockGetAll.mockResolvedValue([]);
});

describe("scheduleDueNotification", () => {
  it("still schedules a single one-time reminder for a non-recurring item", async () => {
    const id = await scheduleDueNotification(makeTask());

    expect(id).toBe("generated-id");
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(mockSchedule.mock.calls[0][0].trigger.type).toBe("date");
    expect(mockSchedule.mock.calls[0][0].identifier).toBeUndefined();
  });

  it("schedules nothing for a non-recurring item whose time has passed", async () => {
    expect(await scheduleDueNotification(makeTask({ datetime: inHours(-1).toISOString() }))).toBeNull();
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it("gives a recurring item one repeating notification, stored as a marker", async () => {
    const task = makeTask({
      recurring_frequency: "daily",
      datetime: new Date("2026-11-17T08:30:00").toISOString(),
      location_raw_text: "Home",
    });

    const result = await scheduleDueNotification(task);

    expect(result).toBe(recurringMarker("task-1"));
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(mockSchedule).toHaveBeenCalledWith({
      identifier: "recurring:task-1:0",
      content: { title: "Water plants", body: "Home" },
      trigger: { type: "daily", hour: 8, minute: 30 },
    });
  });

  it("keeps repeating even when the current occurrence is overdue", async () => {
    const task = makeTask({ recurring_frequency: "daily", datetime: inHours(-30).toISOString() });
    expect(await scheduleDueNotification(task)).toBe(recurringMarker("task-1"));
    expect(mockSchedule).toHaveBeenCalledTimes(1);
  });

  it("makes one notification per weekday for a weekly rule with several days", async () => {
    const task = makeTask({
      recurring_frequency: "weekly",
      recurring_detail: "day_of_week:monday,thursday",
      datetime: new Date("2026-11-17T09:00:00").toISOString(),
    });

    await scheduleDueNotification(task);

    const calls = mockSchedule.mock.calls.map(([request]) => [request.identifier, request.trigger]);
    expect(calls).toEqual([
      ["recurring:task-1:0", { type: "weekly", weekday: 2, hour: 9, minute: 0 }],
      ["recurring:task-1:1", { type: "weekly", weekday: 5, hour: 9, minute: 0 }],
    ]);
  });

  it("uses a monthly trigger for a day-of-month rule", async () => {
    await scheduleDueNotification(
      makeTask({
        recurring_frequency: "monthly",
        recurring_detail: "day_of_month:1",
        datetime: new Date("2026-12-01T09:00:00").toISOString(),
      })
    );
    expect(mockSchedule.mock.calls[0][0].trigger).toEqual({ type: "monthly", day: 1, hour: 9, minute: 0 });
  });

  it("uses a yearly trigger with a 0-based month", async () => {
    await scheduleDueNotification(
      makeTask({ recurring_frequency: "yearly", datetime: new Date("2027-03-05T09:00:00").toISOString() })
    );
    expect(mockSchedule.mock.calls[0][0].trigger).toEqual({ type: "yearly", month: 2, day: 5, hour: 9, minute: 0 });
  });

  it("schedules nothing when notification permission is denied", async () => {
    mockGetPermissions.mockResolvedValue({ status: "denied" });
    mockRequestPermissions.mockResolvedValue({ status: "denied" });

    expect(await scheduleDueNotification(makeTask({ recurring_frequency: "daily" }))).toBeNull();
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it("falls back to a one-time reminder, with nothing half-scheduled, if repeating can't be set up", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockSchedule.mockImplementationOnce(async () => {
      throw new Error("repeating triggers unsupported");
    });
    mockGetAll.mockResolvedValue([{ identifier: "recurring:task-1:0" }]);

    const id = await scheduleDueNotification(makeTask({ recurring_frequency: "daily" }));

    expect(id).toBe("generated-id"); // the one-time fallback
    expect(mockCancel).toHaveBeenCalledWith("recurring:task-1:0"); // partial work rolled back
    expect(mockSchedule.mock.calls.at(-1)?.[0].trigger.type).toBe("date");
  });
});

describe("cancelNotification", () => {
  it("cancels a plain notification id directly", async () => {
    await cancelNotification("abc-123");
    expect(mockCancel).toHaveBeenCalledWith("abc-123");
    expect(mockGetAll).not.toHaveBeenCalled();
  });

  it("cancels every notification belonging to a recurring marker, and only those", async () => {
    mockGetAll.mockResolvedValue([
      { identifier: "recurring:task-1:0" },
      { identifier: "recurring:task-1:1" },
      { identifier: "recurring:task-10:0" }, // a different task whose id merely starts the same
      { identifier: "recurring:task-2:0" },
      { identifier: "some-one-time-id" },
    ]);

    await cancelNotification(recurringMarker("task-1"));

    expect(mockCancel.mock.calls.map((c) => c[0]).sort()).toEqual(["recurring:task-1:0", "recurring:task-1:1"]);
  });

  it("does nothing for null and never throws", async () => {
    await cancelNotification(null);
    expect(mockCancel).not.toHaveBeenCalled();

    mockCancel.mockRejectedValue(new Error("already gone"));
    await expect(cancelNotification("abc")).resolves.toBeUndefined();
  });
});

describe("getScheduledRecurringMarkers", () => {
  it("lists each recurring marker once, ignoring other notifications", async () => {
    mockGetAll.mockResolvedValue([
      { identifier: "recurring:task-1:0" },
      { identifier: "recurring:task-1:1" },
      { identifier: "recurring:task-2:0" },
      { identifier: "plain-id" },
    ]);

    expect([...(await getScheduledRecurringMarkers())].sort()).toEqual(["recurring:task-1", "recurring:task-2"]);
  });
});

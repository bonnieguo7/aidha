import { ensureRecurringReminders } from "../ensureRecurringReminders";
import type { TaskRow } from "../../types/task";

const mockHasPermission = jest.fn();
const mockGetScheduled = jest.fn();
const mockSync = jest.fn();

jest.mock("../notifications", () => ({
  hasNotificationPermission: (...args: unknown[]) => mockHasPermission(...args),
  getScheduledRecurringMarkers: (...args: unknown[]) => mockGetScheduled(...args),
  recurringMarker: (id: string) => `recurring:${id}`,
}));
jest.mock("../syncDueNotification", () => ({
  syncDueNotification: (...args: unknown[]) => mockSync(...args),
}));

function task(id: string, overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id,
    recurring_frequency: "weekly",
    datetime: "2026-11-23T09:00:00.000Z",
    is_completed: false,
    datetime_notification_id: null,
    ...overrides,
  } as unknown as TaskRow;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHasPermission.mockResolvedValue(true);
  mockGetScheduled.mockResolvedValue(new Set<string>());
  mockSync.mockImplementation(async (t: TaskRow) => ({ ...t, datetime_notification_id: `recurring:${t.id}` }));
});

describe("ensureRecurringReminders", () => {
  it("leaves a repeating task alone when its reminder is already scheduled on the phone", async () => {
    const rows = [task("a", { datetime_notification_id: "recurring:a" })];
    mockGetScheduled.mockResolvedValue(new Set(["recurring:a"]));

    expect(await ensureRecurringReminders(rows)).toEqual(rows);
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("upgrades a task that only has an old one-time reminder", async () => {
    const result = await ensureRecurringReminders([task("a", { datetime_notification_id: "legacy-id" })]);

    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(result[0].datetime_notification_id).toBe("recurring:a");
  });

  it("upgrades a task that has no reminder at all", async () => {
    const result = await ensureRecurringReminders([task("a")]);
    expect(result[0].datetime_notification_id).toBe("recurring:a");
  });

  it("re-creates a reminder the database remembers but the phone has lost", async () => {
    // e.g. after reinstalling the app: marker saved on the task, nothing scheduled.
    const result = await ensureRecurringReminders([task("a", { datetime_notification_id: "recurring:a" })]);

    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(result[0].datetime_notification_id).toBe("recurring:a");
  });

  it("only touches the tasks that need it", async () => {
    mockGetScheduled.mockResolvedValue(new Set(["recurring:ok"]));
    const rows = [task("ok", { datetime_notification_id: "recurring:ok" }), task("broken")];

    const result = await ensureRecurringReminders(rows);

    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockSync.mock.calls[0][0].id).toBe("broken");
    expect(result.map((t) => t.datetime_notification_id)).toEqual(["recurring:ok", "recurring:broken"]);
  });

  it("ignores items that aren't active repeating ones", async () => {
    const rows = [
      task("plain", { recurring_frequency: null }),
      task("done", { is_completed: true }),
      task("undated", { datetime: null }),
    ];
    expect(await ensureRecurringReminders(rows)).toEqual(rows);
    expect(mockHasPermission).not.toHaveBeenCalled();
  });

  it("does nothing, and doesn't prompt, without notification permission", async () => {
    mockHasPermission.mockResolvedValue(false);
    const rows = [task("a")];

    expect(await ensureRecurringReminders(rows)).toEqual(rows);
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("never throws - a failure just leaves the rows as they were", async () => {
    mockGetScheduled.mockRejectedValue(new Error("boom"));
    const rows = [task("a")];
    await expect(ensureRecurringReminders(rows)).resolves.toEqual(rows);
  });
});

import { updateDepartureForTask } from "../scheduleDeparture";
import type { TaskRow } from "../../types/task";

// The row the fake database holds; applyPatch's update().eq().select().single()
// chain returns it merged with whatever was written.
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

const mockGeocode = jest.fn();
const mockRoute = jest.fn();
jest.mock("../geocoding", () => ({ geocodeLocation: (...args: unknown[]) => mockGeocode(...args) }));
jest.mock("../travelTime", () => ({ selectTravelRoute: (...args: unknown[]) => mockRoute(...args) }));
jest.mock("../locationPermission", () => ({ reverseGeocodeLabel: jest.fn().mockResolvedValue("Home St") }));
jest.mock("../notifications", () => ({
  cancelNotification: jest.fn().mockResolvedValue(undefined),
  scheduleLeavingNotification: jest.fn().mockResolvedValue("notif-1"),
}));

const here = { latitude: 40.75, longitude: -73.98 };

function erroredTask(): TaskRow {
  return {
    id: "t1",
    title: "Dinner",
    location_raw_text: "Crown Shy",
    // Far enough in the future that the leave-by time is also in the future.
    datetime: new Date(Date.now() + 3 * 3600_000).toISOString(),
    latitude: null,
    longitude: null,
    resolved_address: null,
    departure_origin_label: null,
    travel_duration_minutes: null,
    travel_directions_summary: null,
    leaving_by: null,
    leaving_notification_id: null,
    leaving_by_error: true,
  } as unknown as TaskRow;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStored = erroredTask();
});

describe("updateDepartureForTask - retrying a task stuck on 'Unable to calculate'", () => {
  it("clears the error and sets leaving by once Google answers", async () => {
    mockGeocode.mockResolvedValue({ latitude: 40.7, longitude: -74.0, formattedAddress: "70 Pine St" });
    mockRoute.mockResolvedValue({ durationMinutes: 20, directionsSummary: "Take the 4" });

    const updated = await updateDepartureForTask(erroredTask(), here);

    expect(updated.leaving_by_error).toBe(false);
    expect(updated.leaving_by).not.toBeNull();
    expect(updated.travel_duration_minutes).toBe(20);
    expect(updated.leaving_notification_id).toBe("notif-1");
    expect(updated.resolved_address).toBe("70 Pine St");
  });

  it("stays flagged, keeping the resolved place, when the route still can't be found", async () => {
    mockGeocode.mockResolvedValue({ latitude: 40.7, longitude: -74.0, formattedAddress: "70 Pine St" });
    mockRoute.mockResolvedValue(null);

    const updated = await updateDepartureForTask(erroredTask(), here);

    expect(updated.leaving_by_error).toBe(true);
    expect(updated.leaving_by).toBeNull();
    expect(updated.latitude).toBe(40.7);
  });

  it("stays flagged when the place still can't be found", async () => {
    mockGeocode.mockResolvedValue(null);

    const updated = await updateDepartureForTask(erroredTask(), here);

    expect(updated.leaving_by_error).toBe(true);
    expect(updated.latitude).toBeNull();
    expect(mockRoute).not.toHaveBeenCalled();
  });
});


describe("updateDepartureForTask - Live Activity restart after rescheduling", () => {
  const STARTED = new Date(Date.now() - 10 * 60_000).toISOString();

  // A task whose Live Activity already started, with `leavingByMinutes` as its old leave-by time.
  function startedTask(eventInMinutes: number, oldLeavingByMinutes: number): TaskRow {
    return {
      ...erroredTask(),
      leaving_by_error: false,
      datetime: new Date(Date.now() + eventInMinutes * 60_000).toISOString(),
      leaving_by: new Date(Date.now() + oldLeavingByMinutes * 60_000).toISOString(),
      live_activity_started_at: STARTED,
    } as unknown as TaskRow;
  }

  beforeEach(() => {
    mockGeocode.mockResolvedValue({ latitude: 40.7, longitude: -74.0, formattedAddress: "70 Pine St" });
    mockRoute.mockResolvedValue({ durationMinutes: 20, directionsSummary: null });
  });

  it("clears the started stamp when the event is moved far later", async () => {
    // Event now 4h away (new leave-by ~3.5h out); the old leave-by was 5 minutes from now.
    const task = startedTask(240, 5);
    mockStored = task;

    const updated = await updateDepartureForTask(task, here);

    expect(updated.live_activity_started_at).toBeNull();
    expect(updated.leaving_by_error).toBe(false);
  });

  it("keeps the stamp for a small recalculation", async () => {
    // New leave-by = event - (20 + 8) min; make the old one 2 minutes different.
    const eventIn = 240;
    const task = startedTask(eventIn, eventIn - 28 + 2);
    mockStored = task;

    const updated = await updateDepartureForTask(task, here);

    expect(updated.live_activity_started_at).toBe(STARTED);
  });

  it("keeps the stamp when the new leave-by is already inside the server's window", async () => {
    // Event in 40 min -> leave-by ~12 min out, inside the 14-15 min start window.
    const task = startedTask(40, 90);
    mockStored = task;

    const updated = await updateDepartureForTask(task, here);

    expect(updated.live_activity_started_at).toBe(STARTED);
  });

  it("leaves a task that never had a Live Activity untouched", async () => {
    const task = { ...startedTask(240, 5), live_activity_started_at: null } as TaskRow;
    mockStored = task;

    const updated = await updateDepartureForTask(task, here);

    expect(updated.live_activity_started_at).toBeNull();
  });
});

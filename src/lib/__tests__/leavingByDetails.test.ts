import { leavingByDetails } from "../leavingByDetails";

describe("leavingByDetails", () => {
  it("lists distance, origin and directions, in that order, one per line", () => {
    expect(
      leavingByDetails({
        travel_duration_minutes: 22,
        departure_origin_label: "123 Main St, Brooklyn",
        travel_directions_summary: "Take the A then the L then the 7",
      })
    ).toEqual(["About 22 min away", "From 123 Main St, Brooklyn", "Take the A then the L then the 7"]);
  });

  it("skips what isn't known", () => {
    expect(
      leavingByDetails({ travel_duration_minutes: null, departure_origin_label: null, travel_directions_summary: "6 min walk" })
    ).toEqual(["6 min walk"]);
    expect(
      leavingByDetails({ travel_duration_minutes: 5, departure_origin_label: null, travel_directions_summary: null })
    ).toEqual(["About 5 min away"]);
  });

  it("is empty when there's nothing to show", () => {
    expect(
      leavingByDetails({ travel_duration_minutes: null, departure_origin_label: null, travel_directions_summary: null })
    ).toEqual([]);
  });

  it("keeps a zero-minute trip", () => {
    expect(
      leavingByDetails({ travel_duration_minutes: 0, departure_origin_label: null, travel_directions_summary: null })
    ).toEqual(["About 0 min away"]);
  });

  it("does not cut off a long directions summary", () => {
    const long = "Take the " + Array.from({ length: 12 }, (_, i) => `Line${i}`).join(" then the ");
    expect(
      leavingByDetails({ travel_duration_minutes: 60, departure_origin_label: null, travel_directions_summary: long })
    ).toContain(long);
  });
});

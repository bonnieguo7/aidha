import { rankRecentLocations } from "../recentLocations";

jest.mock("../supabase", () => ({ supabase: {} }));

const rows = (...labels: (string | null)[]) => labels.map((l) => ({ location_raw_text: l }));

describe("rankRecentLocations", () => {
  it("returns nothing for an empty history", () => {
    expect(rankRecentLocations([])).toEqual([]);
  });

  it("ignores rows with no location", () => {
    expect(rankRecentLocations(rows(null, "Equinox", null))).toEqual(["Equinox"]);
  });

  it("ranks places used more than once ahead of newer one-offs", () => {
    // newest first: two one-offs, then a gym used three times
    const history = rows("Crown Shy", "Thai Villa", "Barry's Wall Street", "Barry's Wall Street", "Barry's Wall Street");
    expect(rankRecentLocations(history)).toEqual(["Barry's Wall Street", "Crown Shy", "Thai Villa"]);
  });

  it("orders repeat places by how often they were used, then by recency", () => {
    const history = rows("Office", "Gym", "Gym", "Office", "Gym", "Home", "Home");
    // Gym x3, Office x2 and Home x2: Gym first; Office is newer than Home.
    expect(rankRecentLocations(history)).toEqual(["Gym", "Office", "Home"]);
  });

  it("orders one-off places newest first", () => {
    expect(rankRecentLocations(rows("C", "B", "A"))).toEqual(["C", "B", "A"]);
  });

  it("treats different casing as the same place and shows the newest spelling", () => {
    expect(rankRecentLocations(rows("equinox", "Equinox", "EQUINOX"))).toEqual(["equinox"]);
  });

  it("caps the list at four", () => {
    expect(rankRecentLocations(rows("a", "b", "c", "d", "e", "f"))).toEqual(["a", "b", "c", "d"]);
  });

  it("skips labels too long to fit on a chip", () => {
    const address = "123 Some Very Long Street Name, Brooklyn, New York 11201";
    expect(rankRecentLocations(rows(address, "Equinox"))).toEqual(["Equinox"]);
  });

  it("trims whitespace", () => {
    expect(rankRecentLocations(rows("  Equinox  ", "Equinox"))).toEqual(["Equinox"]);
  });
});

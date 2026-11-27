import { finalizeHabit } from "../habits";
import { HABIT_SUGGESTIONS, hasHabitTitled } from "../habitSuggestions";

describe("HABIT_SUGGESTIONS", () => {
  const all = HABIT_SUGGESTIONS.flatMap((g) => g.habits);

  it("includes the everyday basics", () => {
    const titles = all.map((h) => h.draft.title);
    expect(titles).toEqual(
      expect.arrayContaining(["Sleep 8 hours", "Drink 8 glasses of water", "Exercise for 30 minutes"])
    );
  });

  it("only offers habits that save as they are", () => {
    for (const { draft } of all) expect(finalizeHabit(draft)).toEqual(draft);
  });

  it("has no duplicate names", () => {
    const titles = all.map((h) => h.draft.title.toLowerCase());
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("hasHabitTitled", () => {
  it("matches names regardless of case and spacing", () => {
    expect(hasHabitTitled(["  sleep 8  hours "], "Sleep 8 hours")).toBe(true);
    expect(hasHabitTitled(["Sleep 7 hours"], "Sleep 8 hours")).toBe(false);
  });
});

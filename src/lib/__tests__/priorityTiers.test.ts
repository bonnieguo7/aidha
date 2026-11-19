import { groupFlexibleByPriority } from "../priorityTiers";
import type { Priority, TaskRow } from "../../types/task";

function task(id: string, priority: Priority | null, type: "task" | "event" = "task"): TaskRow {
  return { id, type, priority } as unknown as TaskRow;
}

const summary = (tasks: TaskRow[]) =>
  groupFlexibleByPriority(tasks).map((tier) => [tier.label, tier.items.map((t) => t.id)]);

describe("groupFlexibleByPriority", () => {
  it("orders tiers High, Medium, Low and drops empty ones", () => {
    expect(summary([task("l", "low"), task("h", "high")])).toEqual([
      ["High", ["h"]],
      ["Low", ["l"]],
    ]);
  });

  it("groups a task with no priority into Low instead of a separate tier", () => {
    expect(summary([task("a", "low"), task("b", null), task("c", "normal")])).toEqual([
      ["Medium", ["c"]],
      ["Low", ["a", "b"]],
    ]);
  });

  it("never produces a 'No priority set' tier", () => {
    const labels = groupFlexibleByPriority([task("a", null), task("b", null)]).map((t) => t.label);
    expect(labels).toEqual(["Low"]);
  });

  it("keeps an item with no priority in Low even if it isn't a task", () => {
    expect(summary([task("e", null, "event")])).toEqual([["Low", ["e"]]]);
  });

  it("returns nothing for an empty list", () => {
    expect(groupFlexibleByPriority([])).toEqual([]);
  });
});

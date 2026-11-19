import type { Priority, TaskRow } from "../types/task";
import { effectivePriority } from "./priority";

export interface PriorityTier {
  key: string;
  label: string;
  priority: Priority | null;
  items: TaskRow[];
}

// Splits "When you have time" into high/normal/low tiers, in that fixed display
// order, dropping any tier with nothing in it. A task with no priority (one
// saved before Aidha always asked) is grouped with Low.
export function groupFlexibleByPriority(flexibleList: TaskRow[]): PriorityTier[] {
  const tiers: PriorityTier[] = [
    { key: "high", label: "High", priority: "high", items: [] },
    { key: "normal", label: "Medium", priority: "normal", items: [] },
    { key: "low", label: "Low", priority: "low", items: [] },
  ];
  const byPriority = new Map(tiers.map((tier) => [tier.priority, tier]));
  for (const task of flexibleList) {
    (byPriority.get(effectivePriority(task)) ?? byPriority.get("low")!).items.push(task);
  }
  return tiers.filter((tier) => tier.items.length > 0);
}


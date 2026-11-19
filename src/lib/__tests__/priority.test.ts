import { DEFAULT_TASK_PRIORITY, effectivePriority } from "../priority";

describe("effectivePriority", () => {
  it("keeps a stored priority", () => {
    expect(effectivePriority({ type: "task", priority: "high" })).toBe("high");
    expect(effectivePriority({ type: "task", priority: "normal" })).toBe("normal");
    expect(effectivePriority({ type: "task", priority: "low" })).toBe("low");
  });

  it("treats an unset task priority as low", () => {
    expect(effectivePriority({ type: "task", priority: null })).toBe(DEFAULT_TASK_PRIORITY);
    expect(DEFAULT_TASK_PRIORITY).toBe("low");
  });

  it("leaves an event's priority alone, set or not", () => {
    expect(effectivePriority({ type: "event", priority: null })).toBeNull();
    expect(effectivePriority({ type: "event", priority: "high" })).toBe("high");
  });
});

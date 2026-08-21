import type { TaskRow, TaskType } from "../types/task";

// Shared by the "Today", "My Tasks", and "Archive" tabs, which each register
// their own list screen plus this same EditTask route.
export type TasksStackParamList = {
  TodayList: undefined;
  // Optional: set by the Today screen's calendar shortcut so "My Tasks" opens
  // straight into Events > Calendar instead of its default Tasks > List view.
  TaskList: { initialViewMode?: TaskType; initialEventView?: "list" | "calendar" } | undefined;
  ArchiveList: undefined;
  EditTask: { task: TaskRow };
};

import type { HabitRow } from "../types/habit";
import type { TaskRow, TaskType } from "../types/task";

// Shared by the "Today" and "Tasks" tabs, which each register their own list
// screen plus this same EditTask route. Archive isn't a separate route - it's
// a toggle within the "Tasks" tab's own TaskList screen.
export type TasksStackParamList = {
  TodayList: undefined;
  // Optional: set by the Today screen's calendar shortcut so "Tasks" opens
  // straight into Events > Calendar instead of its default Tasks > List view.
  TaskList: { initialViewMode?: TaskType; initialEventView?: "list" | "calendar" } | undefined;
  EditTask: { task: TaskRow };
  HabitDetail: { habit: HabitRow };
  // The Habits tab: the list of habits, and the page for starting a new one.
  HabitsHome: undefined;
  NewHabit: undefined;
  // Only registered in the Today stack - opened from Today's avatar and gear.
  Profile: undefined;
  // Tasks completed in [start, end) - ISO strings, since route params should
  // stay serializable. `title` names the period ("This week", "October").
  CompletedTasks: { title: string; start: string; end: string };
};

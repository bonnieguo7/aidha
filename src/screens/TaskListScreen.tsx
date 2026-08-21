import { useEffect } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import TaskSectionList from "../components/TaskSectionList";
import type { TasksStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<TasksStackParamList, "TaskList">;

export default function TaskListScreen({ route, navigation }: Props) {
  const { initialViewMode, initialEventView } = route.params ?? {};

  // Clear the params once they've been read below, so navigating here again
  // later with the same target view (e.g. tapping the calendar shortcut twice
  // with a manual switch away in between) still re-triggers it - otherwise an
  // unchanged prop value wouldn't re-fire TaskSectionList's effect.
  useEffect(() => {
    if (initialViewMode || initialEventView) {
      navigation.setParams({ initialViewMode: undefined, initialEventView: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialViewMode, initialEventView]);

  return (
    <TaskSectionList
      completed={false}
      initialViewMode={initialViewMode}
      initialEventView={initialEventView}
      onSelectTask={(task) => navigation.navigate("EditTask", { task })}
    />
  );
}

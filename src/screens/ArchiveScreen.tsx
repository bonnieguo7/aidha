import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import TaskSectionList from "../components/TaskSectionList";
import type { TasksStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<TasksStackParamList, "ArchiveList">;

export default function ArchiveScreen({ navigation }: Props) {
  return (
    <TaskSectionList
      completed
      onSelectTask={(task) => navigation.navigate("EditTask", { task })}
    />
  );
}

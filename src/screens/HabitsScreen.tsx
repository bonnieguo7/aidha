import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { StyleSheet, View } from "react-native";
import HabitList from "../components/HabitList";
import { colors } from "../lib/theme";
import type { TasksStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<TasksStackParamList, "HabitsHome">;

// The Habits tab's first screen.
export default function HabitsScreen({ navigation }: Props) {
  return (
    <View style={styles.container}>
      <HabitList
        onSelectHabit={(habit) => navigation.navigate("HabitDetail", { habit })}
        onNewHabit={() => navigation.navigate("NewHabit")}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
});

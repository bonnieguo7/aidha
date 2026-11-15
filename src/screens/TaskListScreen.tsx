import { Ionicons } from "@expo/vector-icons";
import { useEffect, useLayoutEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import TaskSectionList from "../components/TaskSectionList";
import { useAuth } from "../lib/AuthContext";
import { colors } from "../lib/theme";
import type { TasksStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<TasksStackParamList, "TaskList">;

export default function TaskListScreen({ route, navigation }: Props) {
  const { signOut } = useAuth();
  const { initialViewMode, initialEventView } = route.params ?? {};
  // Archive isn't a separate tab/route (see navigation/types.ts) - it's this
  // same screen with completed=true, toggled via the header icon below.
  const [showArchive, setShowArchive] = useState(false);

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

  useLayoutEffect(() => {
    navigation.setOptions({
      title: showArchive ? "Archive" : "Tasks",
      headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable onPress={() => setShowArchive((prev) => !prev)} hitSlop={8}>
            <Ionicons
              name={showArchive ? "list-outline" : "archive-outline"}
              size={20}
              color={colors.textPrimary}
            />
          </Pressable>
          <Pressable onPress={signOut} hitSlop={8}>
            <Text style={styles.signOut}>Sign out</Text>
          </Pressable>
        </View>
      ),
    });
  }, [navigation, showArchive, signOut]);

  return (
    <TaskSectionList
      completed={showArchive}
      initialViewMode={initialViewMode}
      initialEventView={initialEventView}
      onSelectTask={(task) => navigation.navigate("EditTask", { task })}
    />
  );
}

const styles = StyleSheet.create({
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  signOut: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: "600",
  },
});

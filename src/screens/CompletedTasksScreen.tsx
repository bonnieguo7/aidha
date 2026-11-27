import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from "react-native";
import { fetchCompletedItems, type CompletedItem } from "../lib/fetchAccomplishments";
import { colors } from "../lib/theme";
import type { TasksStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<TasksStackParamList, "CompletedTasks">;

interface DaySection {
  key: string;
  title: string;
  data: CompletedItem[];
}

function dayTitle(day: Date, now: Date): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (day.getTime() === today.getTime()) return "Today";
  if (day.getTime() === yesterday.getTime()) return "Yesterday";
  return day.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

// Groups items (already newest first) by the local day they were done on.
function groupByDay(items: CompletedItem[], now: Date): DaySection[] {
  const sections: DaySection[] = [];
  for (const item of items) {
    const done = new Date(item.completed_at);
    const day = new Date(done.getFullYear(), done.getMonth(), done.getDate());
    const key = day.toISOString();
    const last = sections[sections.length - 1];
    if (last?.key === key) last.data.push(item);
    else sections.push({ key, title: dayTitle(day, now), data: [item] });
  }
  return sections;
}

const completedTime = (item: CompletedItem) =>
  new Date(item.completed_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

// The tasks the user checked off and the habits they checked in on in one week
// or month, opened from the Profile screen's counts. Tapping one opens its
// details, like the Archive does.
export default function CompletedTasksScreen({ route, navigation }: Props) {
  const { start, end } = route.params;
  const [tasks, setTasks] = useState<CompletedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const loadId = useRef(0);

  const load = useCallback(async () => {
    const id = ++loadId.current;
    const rows = await fetchCompletedItems(new Date(start), new Date(end));
    if (id !== loadId.current) return;
    if (!rows) {
      setError("Couldn't load these. Pull down to try again.");
      return;
    }
    setError(null);
    setTasks(rows);
  }, [start, end]);

  // Reloads on focus, so a task restored from its details screen drops out.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleRefresh() {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  }

  const sections = useMemo(() => groupByDay(tasks ?? [], new Date()), [tasks]);

  if (!tasks && !error) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <SectionList
      style={styles.container}
      contentContainerStyle={styles.content}
      sections={sections}
      keyExtractor={(item) => `${item.kind}:${item.id}`}
      stickySectionHeadersEnabled={false}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.accent} />}
      ListHeaderComponent={
        <>
          {error && <Text style={styles.error}>{error}</Text>}
          {tasks && tasks.length > 0 && (
            <Text style={styles.summary}>
              {tasks.length} completed
            </Text>
          )}
        </>
      }
      ListEmptyComponent={
        tasks ? (
          <View style={styles.empty}>
            <Ionicons name="checkmark-done-outline" size={28} color={colors.textMuted} />
            <Text style={styles.emptyText}>Nothing checked off in this period yet.</Text>
          </View>
        ) : null
      }
      renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
      renderItem={({ item, index, section }) => (
        <Pressable
          onPress={() =>
            item.kind === "task"
              ? navigation.navigate("EditTask", { task: item.task })
              : navigation.navigate("HabitDetail", { habit: item.habit })
          }
          style={({ pressed }) => [
            styles.row,
            index === 0 && styles.rowFirst,
            index === section.data.length - 1 && styles.rowLast,
            pressed && styles.rowPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${item.kind === "habit" ? "Habit: " : ""}${item.title}, done at ${completedTime(item)}`}
        >
          <View style={styles.check}>
            <Ionicons name={item.kind === "habit" ? "repeat" : "checkmark"} size={14} color={colors.success} />
          </View>
          <View style={styles.titleWrap}>
            <Text style={styles.title} numberOfLines={2}>
              {item.title}
            </Text>
            {item.kind === "habit" && <Text style={styles.kind}>Habit</Text>}
          </View>
          <Text style={styles.time}>{completedTime(item)}</Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  summary: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: colors.textSecondary,
    marginTop: 16,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  rowFirst: {
    borderTopWidth: 1,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  rowLast: {
    borderBottomWidth: 1,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
  },
  rowPressed: {
    backgroundColor: colors.surfaceAlt,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.successSoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  titleWrap: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    color: colors.textPrimary,
  },
  kind: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
  },
  time: {
    fontSize: 13,
    color: colors.textMuted,
    marginLeft: 12,
    fontVariant: ["tabular-nums"],
  },
  empty: {
    alignItems: "center",
    paddingVertical: 48,
    gap: 10,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
});

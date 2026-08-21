import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import CalendarMonthView, { dateKey } from "./CalendarMonthView";
import { archivePastEvents } from "../lib/autoArchivePastEvents";
import { confirmDelete } from "../lib/confirmDelete";
import { openInMaps } from "../lib/maps";
import { cancelNotification } from "../lib/notifications";
import { supabase } from "../lib/supabase";
import { colors } from "../lib/theme";
import type { RecurringFrequency, TaskRow, TaskType } from "../types/task";

interface Section {
  title: string;
  data: TaskRow[];
}

type EventView = "list" | "calendar";

interface Props {
  completed: boolean;
  onSelectTask: (task: TaskRow) => void;
  // Set by a caller that wants this list to open into a specific view - e.g.
  // the Today screen's calendar shortcut - rather than the default Tasks/List.
  initialViewMode?: TaskType;
  initialEventView?: EventView;
}

const FREQUENCY_RANK: Record<RecurringFrequency, number> = {
  daily: 0,
  weekly: 1,
  monthly: 2,
  yearly: 3,
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDatetime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Tasks split into "Once" vs "Recurring" (the thing that matters for a to-do);
// events stay split by whether they have a date (the thing that matters for
// something you have to physically attend).
function buildSections(rows: TaskRow[], viewMode: TaskType): Section[] {
  const filtered = rows.filter((t) => t.type === viewMode);

  if (viewMode === "task") {
    const once = filtered.filter((t) => !t.recurring_frequency);
    const recurring = filtered.filter((t) => t.recurring_frequency);

    once.sort((a, b) => {
      if (a.datetime && b.datetime) return a.datetime < b.datetime ? -1 : 1;
      if (a.datetime) return -1;
      if (b.datetime) return 1;
      return 0;
    });
    recurring.sort((a, b) => {
      const rankDiff = FREQUENCY_RANK[a.recurring_frequency!] - FREQUENCY_RANK[b.recurring_frequency!];
      return rankDiff !== 0 ? rankDiff : a.title.localeCompare(b.title);
    });

    const sections: Section[] = [];
    if (once.length > 0) sections.push({ title: "Once", data: once });
    if (recurring.length > 0) sections.push({ title: "Recurring", data: recurring });
    return sections;
  }

  const withDate = filtered.filter((t) => t.datetime);
  const withoutDate = filtered.filter((t) => !t.datetime);
  withDate.sort((a, b) => (a.datetime! < b.datetime! ? -1 : 1));

  const sections: Section[] = [];
  if (withDate.length > 0) sections.push({ title: "Has a date", data: withDate });
  if (withoutDate.length > 0) sections.push({ title: "No date", data: withoutDate });
  return sections;
}

export default function TaskSectionList({
  completed,
  onSelectTask,
  initialViewMode,
  initialEventView,
}: Props) {
  const [viewMode, setViewMode] = useState<TaskType>(initialViewMode ?? "task");
  const [eventView, setEventView] = useState<EventView>(initialEventView ?? "list");

  // The lazy initializers above only cover the very first mount - React
  // Navigation keeps this screen mounted between tab visits, so a later
  // navigation here with new initial-view props needs its own effect to take.
  useEffect(() => {
    if (initialViewMode) setViewMode(initialViewMode);
    if (initialEventView) setEventView(initialEventView);
  }, [initialViewMode, initialEventView]);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [allTasks, setAllTasks] = useState<TaskRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sections = useMemo(() => buildSections(allTasks, viewMode), [allTasks, viewMode]);

  // Which calendar days get a dot - any date an event (this tab's completed/not
  // filter already applied by the query) falls on.
  const eventDates = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTasks) {
      if (t.type === "event" && t.datetime) set.add(dateKey(new Date(t.datetime)));
    }
    return set;
  }, [allTasks]);

  const selectedDateEvents = useMemo(() => {
    const key = dateKey(selectedDate);
    return allTasks
      .filter((t) => t.type === "event" && t.datetime && dateKey(new Date(t.datetime)) === key)
      .sort((a, b) => (a.datetime! < b.datetime! ? -1 : 1));
  }, [allTasks, selectedDate]);

  // Swiping/tapping to a different month leaves the old selected day showing an
  // agenda for a day you can no longer see - jump to "today" if it's back in
  // view, otherwise the 1st of the new month, so the agenda always matches the grid.
  function handleCalendarMonthChange(monthStart: Date) {
    const now = new Date();
    if (monthStart.getFullYear() === now.getFullYear() && monthStart.getMonth() === now.getMonth()) {
      setSelectedDate(now);
    } else {
      setSelectedDate(monthStart);
    }
  }

  const emptyText = completed
    ? viewMode === "task"
      ? "No archived tasks yet."
      : "No archived events yet."
    : viewMode === "task"
      ? "No tasks saved yet."
      : "No events saved yet.";

  async function loadTasks() {
    setError(null);
    const { data, error: fetchError } = await supabase
      .from("tasks")
      .select("*")
      .eq("is_completed", completed)
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      return;
    }

    const rows = (data ?? []) as TaskRow[];
    // Only the active (not-completed) list has anything for the sweep to do -
    // querying is_completed=true (the Archive tab) already excludes them.
    setAllTasks(completed ? rows : await archivePastEvents(rows));
  }

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      loadTasks().finally(() => setIsLoading(false));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [completed])
  );

  async function handleRefresh() {
    setIsRefreshing(true);
    await loadTasks();
    setIsRefreshing(false);
  }

  function removeTask(id: string) {
    setAllTasks((prev) => prev.filter((t) => t.id !== id));
  }

  async function handleToggleComplete(item: TaskRow) {
    const completing = !completed;
    const patch: Record<string, unknown> = { is_completed: completing };

    // A completed/archived task shouldn't still ring a "time to leave" alert -
    // cancel it and clear the stale id so the task doesn't misleadingly look like
    // it still has an active reminder.
    if (completing && item.leaving_notification_id) {
      await cancelNotification(item.leaving_notification_id);
      patch.leaving_notification_id = null;
    }

    const { error: updateError } = await supabase.from("tasks").update(patch).eq("id", item.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    removeTask(item.id);
  }

  async function handleDelete(item: TaskRow) {
    const confirmed = await confirmDelete(`Delete "${item.title}"? This can't be undone.`);
    if (!confirmed) return;

    await cancelNotification(item.leaving_notification_id);
    const { error: deleteError } = await supabase.from("tasks").delete().eq("id", item.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    removeTask(item.id);
  }

  function renderTaskRow(item: TaskRow) {
    const metaText =
      viewMode === "task"
        ? item.recurring_frequency
          ? capitalize(item.recurring_frequency)
          : item.datetime
            ? formatShortDate(item.datetime)
            : null
        : null;

    // Events archive themselves once their time passes (see loadTasks) rather
    // than being manually checked off - so the checkbox only makes sense for
    // tasks, or for an already-archived event (where it still works as an
    // "undo" back out of the Archive tab).
    const showCheckbox = item.type !== "event" || completed;

    return (
      <View style={styles.row}>
        {showCheckbox && (
          <Pressable
            onPress={() => handleToggleComplete(item)}
            style={({ pressed }) => [styles.checkboxButton, pressed && styles.rowPressed]}
            hitSlop={8}
          >
            <Ionicons
              name={completed ? "checkbox" : "square-outline"}
              size={22}
              color={completed ? colors.success : colors.textMuted}
            />
          </Pressable>
        )}
        <Pressable
          style={({ pressed }) => [styles.rowContent, pressed && styles.rowPressed]}
          onPress={() => onSelectTask(item)}
        >
          <View style={styles.rowMain}>
            <Text style={[styles.rowTitle, completed && styles.rowTitleCompleted]}>{item.title}</Text>
            {viewMode === "event" && item.datetime && (
              <Text style={styles.rowSubtitle}>{formatDatetime(item.datetime)}</Text>
            )}
            {item.location_raw_text && (
              <Pressable
                onPress={() => openInMaps(item.resolved_address ?? item.location_raw_text!)}
                hitSlop={6}
                style={styles.locationRow}
              >
                <Ionicons name="navigate-outline" size={12} color={colors.accent} />
                <Text style={styles.rowSubtitleLink}>{item.location_raw_text}</Text>
              </Pressable>
            )}
          </View>
          {metaText && <Text style={styles.metaText}>{metaText}</Text>}
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </Pressable>
        <Pressable
          onPress={() => handleDelete(item)}
          style={({ pressed }) => [styles.deleteIconButton, pressed && styles.rowPressed]}
          hitSlop={8}
        >
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
        </Pressable>
      </View>
    );
  }

  const showCalendar = viewMode === "event" && eventView === "calendar";

  return (
    <View style={styles.container}>
      <View style={styles.tabRow}>
        <Pressable
          onPress={() => setViewMode("task")}
          style={[styles.tab, viewMode === "task" && styles.tabActive]}
        >
          <Text style={[styles.tabText, viewMode === "task" && styles.tabTextActive]}>Tasks</Text>
        </Pressable>
        <Pressable
          onPress={() => setViewMode("event")}
          style={[styles.tab, viewMode === "event" && styles.tabActive]}
        >
          <Text style={[styles.tabText, viewMode === "event" && styles.tabTextActive]}>Events</Text>
        </Pressable>
      </View>

      {viewMode === "event" && (
        <View style={styles.subTabRow}>
          <Pressable
            onPress={() => setEventView("list")}
            style={[styles.subTab, eventView === "list" && styles.subTabActive]}
          >
            <Text style={[styles.subTabText, eventView === "list" && styles.subTabTextActive]}>List</Text>
          </Pressable>
          <Pressable
            onPress={() => setEventView("calendar")}
            style={[styles.subTab, eventView === "calendar" && styles.subTabActive]}
          >
            <Text style={[styles.subTabText, eventView === "calendar" && styles.subTabTextActive]}>
              Calendar
            </Text>
          </Pressable>
        </View>
      )}

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : showCalendar ? (
        <View style={styles.calendarContainer}>
          {/* The swipeable grid stays outside the ScrollView below - nesting a
              horizontal-swipe PanResponder inside a vertical ScrollView means the
              ScrollView's own (native, JS-bridge-independent) pan recognizer can
              grab the drag before the grid ever sees it. */}
          <View style={styles.calendarGridWrap}>
            <CalendarMonthView
              eventDates={eventDates}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              onMonthChange={handleCalendarMonthChange}
            />
          </View>
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.accent} />
            }
          >
            <Text style={styles.agendaLabel}>
              {selectedDate.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            </Text>
            {selectedDateEvents.length === 0 ? (
              <Text style={styles.agendaEmptyText}>No events this day.</Text>
            ) : (
              selectedDateEvents.map((item) => <View key={item.id}>{renderTaskRow(item)}</View>)
            )}
          </ScrollView>
        </View>
      ) : sections.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>{emptyText}</Text>
        </View>
      ) : (
        <SectionList
          style={styles.list}
          sections={sections}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.accent} />
          }
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeader}>{section.title}</Text>
          )}
          renderItem={({ item }) => renderTaskRow(item)}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  tabRow: {
    flexDirection: "row",
    backgroundColor: colors.surfaceAlt,
    borderRadius: 999,
    padding: 4,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: "center",
  },
  tabActive: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  tabText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: colors.textPrimary,
  },
  subTabRow: {
    flexDirection: "row",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  calendarContainer: {
    flex: 1,
  },
  calendarGridWrap: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  subTab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  subTabActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  subTabText: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.textPrimary,
  },
  subTabTextActive: {
    color: colors.onSurfaceInverse,
    fontWeight: "600",
  },
  agendaLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 18,
    marginBottom: 8,
  },
  agendaEmptyText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  list: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    padding: 20,
  },
  error: {
    color: colors.danger,
    textAlign: "center",
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 16,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textSecondary,
    textTransform: "uppercase",
    marginTop: 16,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  checkboxButton: {
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  rowContent: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    gap: 8,
  },
  deleteIconButton: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowMain: {
    flex: 1,
    marginRight: 4,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  rowTitleCompleted: {
    color: colors.textMuted,
    textDecorationLine: "line-through",
  },
  rowSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  rowSubtitleLink: {
    fontSize: 13,
    color: colors.accent,
  },
  metaText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
});

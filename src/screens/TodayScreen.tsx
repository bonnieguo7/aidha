import { Ionicons } from "@expo/vector-icons";
import { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../lib/AuthContext";
import { archivePastEvents } from "../lib/autoArchivePastEvents";
import { cancelNotification } from "../lib/notifications";
import { refreshUpcomingDepartures } from "../lib/refreshUpcomingDepartures";
import { snoozeTask, type SnoozeOption } from "../lib/snoozeTask";
import { supabase } from "../lib/supabase";
import { colors } from "../lib/theme";
import type { TasksStackParamList } from "../navigation/types";
import type { TaskRow } from "../types/task";

type Props = NativeStackScreenProps<TasksStackParamList, "TodayList">;

type HeroReason = "leaving" | "upcoming" | "overdue" | "priority";
type SectionKind = "overdue" | "laterToday" | "priority" | "flexible";

interface TodayGroups {
  hero: TaskRow | null;
  heroReason: HeroReason;
  overdueList: TaskRow[];
  laterTodayList: TaskRow[];
  noDateHighPriorityList: TaskRow[];
  flexibleList: TaskRow[];
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatRelative(target: Date, now: Date): string {
  const diffMin = Math.round((target.getTime() - now.getTime()) / 60000);
  if (diffMin <= 1) return "now";
  if (diffMin < 60) return `in ${diffMin} min`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 6) return `in ${diffHours} hr`;
  return `at ${formatTime(target.toISOString())}`;
}

// Groups today's open tasks/events into: one "next up" item to act on right
// now, an overdue backlog, the rest of today's dated items, undated items
// flagged high-priority, and undated flexible tasks (requires_downtime) that
// otherwise never surfaced anywhere - the "downtime detection" the schema was
// originally built for but never had a UI.
function buildTodayGroups(rows: TaskRow[], now: Date): TodayGroups {
  const startOfTomorrow = new Date(now);
  startOfTomorrow.setHours(24, 0, 0, 0);

  // requires_downtime is a hard override: a flexible task (e.g. "book a bus" -
  // whose datetime may just be a computed few-days-ahead nudge, not a fixed
  // moment) always routes to "When you have time" instead of the date/
  // priority-based sections below, whether or not it happens to have a date.
  const overdue = rows
    .filter((t) => !t.requires_downtime && t.datetime && new Date(t.datetime) < now)
    .sort((a, b) => (a.datetime! < b.datetime! ? -1 : 1));

  const laterToday = rows
    .filter(
      (t) => !t.requires_downtime && t.datetime && new Date(t.datetime) >= now && new Date(t.datetime) < startOfTomorrow
    )
    .sort((a, b) => {
      // A leaving_by that's already passed is still the more urgent signal
      // than the event's own start time - use it whenever it exists, not
      // only while it's still in the future.
      const aKey = a.leaving_by ?? a.datetime!;
      const bKey = b.leaving_by ?? b.datetime!;
      return aKey < bKey ? -1 : 1;
    });

  const noDateHighPriority = rows.filter((t) => !t.requires_downtime && !t.datetime && t.priority === "high");

  const flexible = rows.filter((t) => t.requires_downtime);

  let hero: TaskRow | null = null;
  let heroReason: HeroReason = "upcoming";
  if (laterToday.length > 0) {
    hero = laterToday[0];
    // Even a leaving_by that's already passed is worth surfacing as "leaving"
    // - formatRelative collapses anything <= 1 minute (including negative,
    // i.e. already past) into "now", so the pill reads "Leave now" instead of
    // silently disappearing right when it matters most.
    heroReason = hero.leaving_by ? "leaving" : "upcoming";
  } else if (overdue.length > 0) {
    hero = overdue[0];
    heroReason = "overdue";
  } else if (noDateHighPriority.length > 0) {
    hero = noDateHighPriority[0];
    heroReason = "priority";
  }

  return {
    hero,
    heroReason,
    overdueList: overdue.filter((t) => t.id !== hero?.id),
    laterTodayList: laterToday.filter((t) => t.id !== hero?.id),
    noDateHighPriorityList: noDateHighPriority.filter((t) => t.id !== hero?.id),
    // Flexible/whenever tasks are never selected as hero (see above), so no
    // exclusion needed here.
    flexibleList: flexible,
  };
}

function sectionAccent(kind: SectionKind): { text: string; soft: string } {
  if (kind === "overdue") return { text: colors.warning, soft: colors.warningSoft };
  if (kind === "laterToday") return { text: colors.success, soft: colors.successSoft };
  // Deliberately neutral/desaturated rather than one of the urgency colors -
  // "whenever" should read calm, not competing for attention with what's
  // actually due today.
  if (kind === "flexible") return { text: colors.textSecondary, soft: colors.surfaceAlt };
  return { text: colors.accent, soft: colors.accentSoft };
}

function rowIcon(kind: SectionKind, task: TaskRow): keyof typeof Ionicons.glyphMap {
  if (kind === "overdue") return task.recurring_frequency ? "repeat-outline" : "checkmark-outline";
  if (kind === "laterToday") return "alarm-outline";
  if (kind === "flexible") return task.recurring_frequency ? "repeat-outline" : "checkmark-outline";
  return "flag-outline";
}

function rowSubtitle(kind: SectionKind, task: TaskRow): string {
  if (task.recurring_frequency) {
    const detail = task.recurring_detail ? `, ${task.recurring_detail}` : "";
    return kind === "laterToday"
      ? `${capitalize(task.recurring_frequency)} at ${formatTime(task.datetime)}`
      : `${capitalize(task.recurring_frequency)}${detail}`;
  }
  if (kind === "overdue" && task.datetime) return `Was due ${formatShortDate(task.datetime)}`;
  if (kind === "priority") return "High priority · no time set";
  // A flexible task can still carry a computed nudge date (e.g. "book a bus"
  // 2 days ahead of the trip) - say so rather than claiming there's none.
  if (kind === "flexible") return task.datetime ? `Reminder ${formatShortDate(task.datetime)}` : "No deadline";
  return "";
}

function rowPillText(kind: SectionKind, task: TaskRow): string | null {
  if (task.recurring_frequency) return capitalize(task.recurring_frequency);
  if (kind === "overdue" && task.datetime) return formatTime(task.datetime);
  if (kind === "laterToday" && task.datetime) return formatTime(task.datetime);
  return null;
}

export default function TodayScreen({ navigation }: Props) {
  const { signOut } = useAuth();
  const [allTasks, setAllTasks] = useState<TaskRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const now = useMemo(() => new Date(), [allTasks]);
  const groups = useMemo(() => buildTodayGroups(allTasks, now), [allTasks, now]);

  async function loadTasks() {
    setError(null);
    const { data, error: fetchError } = await supabase
      .from("tasks")
      .select("*")
      .eq("is_completed", false)
      .order("datetime", { ascending: true, nullsFirst: false });

    if (fetchError) {
      setError(fetchError.message);
      return;
    }

    const active = await archivePastEvents((data ?? []) as TaskRow[]);
    setAllTasks(await refreshUpcomingDepartures(active));
  }

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      loadTasks().finally(() => setIsLoading(false));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  async function handleRefresh() {
    setIsRefreshing(true);
    await loadTasks();
    setIsRefreshing(false);
  }

  async function handleComplete(item: TaskRow) {
    setBusyId(item.id);
    await cancelNotification(item.leaving_notification_id);
    await cancelNotification(item.datetime_notification_id);
    const { error: updateError } = await supabase
      .from("tasks")
      .update({ is_completed: true, leaving_notification_id: null, datetime_notification_id: null })
      .eq("id", item.id);
    setBusyId(null);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    setAllTasks((prev) => prev.filter((t) => t.id !== item.id));
  }

  async function applySnooze(item: TaskRow, option: SnoozeOption) {
    setBusyId(item.id);
    await snoozeTask(item, option);
    await loadTasks();
    setBusyId(null);
  }

  function handleSnoozePress(item: TaskRow) {
    Alert.alert(item.title, "Snooze until…", [
      { text: "1 hour", onPress: () => applySnooze(item, "1h") },
      { text: "Tomorrow", onPress: () => applySnooze(item, "tomorrow") },
      { text: "Next week", onPress: () => applySnooze(item, "next_week") },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  function handleSettingsPress() {
    Alert.alert("Sign out", "Sign out of Aidha?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => signOut() },
    ]);
  }

  function openTask(item: TaskRow) {
    navigation.navigate("EditTask", { task: item });
  }

  function goToCalendar() {
    // The parent tab navigator doesn't know about "My Tasks"'s nested stack
    // screens from here, so this cross-navigator call falls outside what its
    // types can express - same reasoning as goToCapture below, just with the
    // extra nested {screen, params} shape needed to land on a specific screen
    // inside that tab's stack rather than just the tab itself.
    (navigation.getParent() as any)?.navigate("My Tasks", {
      screen: "TaskList",
      params: { initialViewMode: "event", initialEventView: "calendar" },
    });
  }

  const hasAnything =
    Boolean(groups.hero) ||
    groups.overdueList.length > 0 ||
    groups.laterTodayList.length > 0 ||
    groups.noDateHighPriorityList.length > 0 ||
    groups.flexibleList.length > 0;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <View style={styles.identity}>
          <View style={styles.avatar}>
            <Ionicons name="sparkles-outline" size={18} color={colors.accent} />
          </View>
          <View>
            <Text style={styles.appName}>Aidha</Text>
          </View>
        </View>
        <View style={styles.topBarActions}>
          <Pressable onPress={goToCalendar} hitSlop={10}>
            <Ionicons name="calendar-outline" size={22} color={colors.textSecondary} />
          </Pressable>
          <Pressable onPress={handleSettingsPress} hitSlop={10}>
            <Ionicons name="settings-outline" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.accent} />
          }
        >
          <Text style={styles.dateLabel}>
            {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }).toUpperCase()}
          </Text>
          <Text style={styles.title}>Today</Text>

          {error && <Text style={styles.error}>{error}</Text>}

          {!hasAnything ? (
            <View style={styles.emptyState}>
              <Ionicons name="sparkles-outline" size={22} color={colors.textMuted} />
              <Text style={styles.emptyText}>Nothing on deck today. Nice.</Text>
            </View>
          ) : (
            <>
              {groups.hero && (
                <HeroCard
                  task={groups.hero}
                  reason={groups.heroReason}
                  now={now}
                  busy={busyId === groups.hero.id}
                  onOpen={() => openTask(groups.hero!)}
                  onComplete={() => handleComplete(groups.hero!)}
                  onSnooze={() => handleSnoozePress(groups.hero!)}
                />
              )}

              {groups.overdueList.length > 0 && (
                <Section kind="overdue" label="Overdue">
                  {groups.overdueList.map((item, index) => (
                    <TaskRowItem
                      key={item.id}
                      kind="overdue"
                      task={item}
                      busy={busyId === item.id}
                      isLast={index === groups.overdueList.length - 1}
                      onOpen={() => openTask(item)}
                      onComplete={() => handleComplete(item)}
                      onSnooze={() => handleSnoozePress(item)}
                    />
                  ))}
                </Section>
              )}

              {groups.laterTodayList.length > 0 && (
                <Section kind="laterToday" label="Later today">
                  {groups.laterTodayList.map((item, index) => (
                    <TaskRowItem
                      key={item.id}
                      kind="laterToday"
                      task={item}
                      busy={busyId === item.id}
                      isLast={index === groups.laterTodayList.length - 1}
                      onOpen={() => openTask(item)}
                      onComplete={() => handleComplete(item)}
                      onSnooze={() => handleSnoozePress(item)}
                    />
                  ))}
                </Section>
              )}

              {groups.noDateHighPriorityList.length > 0 && (
                <Section kind="priority" label="High priority">
                  {groups.noDateHighPriorityList.map((item, index) => (
                    <TaskRowItem
                      key={item.id}
                      kind="priority"
                      task={item}
                      busy={busyId === item.id}
                      isLast={index === groups.noDateHighPriorityList.length - 1}
                      onOpen={() => openTask(item)}
                      onComplete={() => handleComplete(item)}
                      onSnooze={() => handleSnoozePress(item)}
                    />
                  ))}
                </Section>
              )}

              {groups.flexibleList.length > 0 && (
                <Section kind="flexible" label="When you have time">
                  {groups.flexibleList.map((item, index) => (
                    <TaskRowItem
                      key={item.id}
                      kind="flexible"
                      task={item}
                      busy={busyId === item.id}
                      isLast={index === groups.flexibleList.length - 1}
                      onOpen={() => openTask(item)}
                      onComplete={() => handleComplete(item)}
                      onSnooze={() => handleSnoozePress(item)}
                    />
                  ))}
                </Section>
              )}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function HeroCard({
  task,
  reason,
  now,
  busy,
  onOpen,
  onComplete,
  onSnooze,
}: {
  task: TaskRow;
  reason: HeroReason;
  now: Date;
  busy: boolean;
  onOpen: () => void;
  onComplete: () => void;
  onSnooze: () => void;
}) {
  const pill =
    reason === "leaving"
      ? {
          icon: "time-outline" as const,
          text: `Leave ${formatRelative(new Date(task.leaving_by!), now)}`,
          suffix: ` · ${formatTime(task.leaving_by)}`,
        }
      : reason === "upcoming"
        ? { icon: "time-outline" as const, text: formatRelative(new Date(task.datetime!), now), suffix: "" }
        : reason === "overdue"
          ? { icon: "alert-circle-outline" as const, text: `Was due ${formatShortDate(task.datetime!)}`, suffix: "" }
          : { icon: "flag-outline" as const, text: "High priority", suffix: " · no time set" };

  return (
    <View style={styles.heroCard}>
      <View style={styles.heroBar}>
        <View style={styles.heroBarLeft}>
          <Ionicons name="sparkles-outline" size={13} color={colors.onSurfaceInverse} />
          <Text style={styles.heroBarText}>NEXT UP</Text>
        </View>
        {/* Events archive themselves once their time passes (see loadTasks) - */}
        {/* only a task gets a manual complete tap here. */}
        {task.type === "task" && (
          <Pressable onPress={onComplete} disabled={busy} hitSlop={8} style={styles.heroCheck}>
            {busy ? (
              <ActivityIndicator size="small" color={colors.onSurfaceInverse} />
            ) : (
              <Ionicons name="checkmark" size={14} color={colors.onSurfaceInverse} />
            )}
          </Pressable>
        )}
      </View>

      <Pressable onPress={onOpen} style={styles.heroBody}>
        <Text style={styles.heroTitle}>{task.title}</Text>

        {task.location_raw_text && (
          <View style={styles.heroRow}>
            <Ionicons name="location-outline" size={14} color={colors.accent} />
            <Text style={styles.heroRowText}>{task.location_raw_text}</Text>
          </View>
        )}
        {task.datetime && (
          <View style={styles.heroRow}>
            <Ionicons name="calendar-outline" size={14} color={colors.accent} />
            <Text style={styles.heroRowText}>{formatShortDate(task.datetime)}</Text>
          </View>
        )}
        {task.datetime && (
          <View style={styles.heroRow}>
            <Ionicons name="time-outline" size={14} color={colors.accent} />
            <Text style={styles.heroRowText}>{formatTime(task.datetime)}</Text>
          </View>
        )}

        <Pressable onPress={onSnooze} style={styles.heroPill}>
          <View style={styles.heroPillRow}>
            <Ionicons name={pill.icon} size={14} color={colors.accent} />
            <Text style={styles.heroPillText}>
              {pill.text}
              <Text style={styles.heroPillSuffix}>{pill.suffix}</Text>
            </Text>
          </View>
          {reason === "leaving" && task.departure_origin_label && (
            <Text style={styles.heroPillOrigin}>From {task.departure_origin_label}</Text>
          )}
          {reason === "leaving" && task.travel_directions_summary && (
            <Text style={styles.heroPillOrigin}>{task.travel_directions_summary}</Text>
          )}
        </Pressable>
      </Pressable>
    </View>
  );
}

function Section({ kind, label, children }: { kind: SectionKind; label: string; children: React.ReactNode }) {
  const accent = sectionAccent(kind);
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderRow}>
        <View style={[styles.sectionDot, { backgroundColor: accent.text }]} />
        <Text style={[styles.sectionLabel, { color: accent.text }]}>{label}</Text>
      </View>
      <View style={styles.groupCard}>{children}</View>
    </View>
  );
}

function TaskRowItem({
  kind,
  task,
  busy,
  isLast,
  onOpen,
  onComplete,
  onSnooze,
}: {
  kind: SectionKind;
  task: TaskRow;
  busy: boolean;
  isLast: boolean;
  onOpen: () => void;
  onComplete: () => void;
  onSnooze: () => void;
}) {
  const accent = sectionAccent(kind);
  const subtitle = rowSubtitle(kind, task);
  const pillText = rowPillText(kind, task);

  // Events archive themselves once their time passes (see loadTasks) - the
  // avatar stays as a plain icon for them instead of a complete-tap target.
  const avatarIcon = busy ? (
    <ActivityIndicator size="small" color={accent.text} />
  ) : (
    <Ionicons name={rowIcon(kind, task)} size={16} color={accent.text} />
  );

  return (
    <View style={[styles.row, !isLast && styles.rowDivider]}>
      {task.type === "task" ? (
        <Pressable onPress={onComplete} disabled={busy} style={[styles.rowAvatar, { backgroundColor: accent.soft }]}>
          {avatarIcon}
        </Pressable>
      ) : (
        <View style={[styles.rowAvatar, { backgroundColor: accent.soft }]}>{avatarIcon}</View>
      )}
      <Pressable style={styles.rowMain} onPress={onOpen}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {task.title}
        </Text>
        {subtitle.length > 0 && (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </Pressable>
      {pillText && (
        <Pressable onPress={onSnooze} style={[styles.rowPill, { backgroundColor: accent.soft }]}>
          <Text style={[styles.rowPillText, { color: accent.text }]}>{pillText}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  topBarActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  appName: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  appTagline: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  dateLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 30,
    fontWeight: "700",
    color: colors.textPrimary,
    marginTop: 2,
    marginBottom: 16,
  },
  error: {
    color: colors.danger,
    marginBottom: 12,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    gap: 8,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 15,
  },
  heroCard: {
    borderRadius: 18,
    overflow: "hidden",
    marginBottom: 22,
  },
  heroBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.accentDark,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  heroBarLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  heroBarText: {
    color: colors.onSurfaceInverse,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  heroCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroBody: {
    backgroundColor: colors.accentSoft,
    padding: 16,
  },
  heroTitle: {
    fontSize: 19,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 8,
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  heroRowText: {
    fontSize: 14,
    color: colors.accent,
    fontWeight: "500",
  },
  heroPill: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 14,
  },
  heroPillRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  heroPillText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.accent,
  },
  heroPillSuffix: {
    fontWeight: "400",
    color: colors.textSecondary,
  },
  heroPillOrigin: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
    marginLeft: 22,
  },
  section: {
    marginBottom: 20,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  sectionDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  groupCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  rowMain: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  rowSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
  },
  rowPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  rowPillText: {
    fontSize: 12,
    fontWeight: "700",
  },
});

import { Ionicons } from "@expo/vector-icons";
import { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DayView from "../components/DayView";
import TodayHabitsSection from "../components/TodayHabitsSection";
import { useAccomplishments } from "../lib/AccomplishmentsContext";
import { archivePastEvents } from "../lib/autoArchivePastEvents";
import { useHabits } from "../lib/useHabits";
import { getCurrentUserLocation } from "../lib/locationPermission";
import { completeTask } from "../lib/completeTask";
import { ensureRecurringReminders } from "../lib/ensureRecurringReminders";
import { isInProgress, itemEnd } from "../lib/duration";
import { effectivePriority } from "../lib/priority";
import { groupFlexibleByPriority } from "../lib/priorityTiers";
import { refreshUpcomingDepartures } from "../lib/refreshUpcomingDepartures";
import { updateDepartureForTask } from "../lib/scheduleDeparture";
import { snoozeTask, type SnoozeOption } from "../lib/snoozeTask";
import { supabase } from "../lib/supabase";
import { configureRemovalAnimation, useCompleteAnimation } from "../lib/useCompleteAnimation";
import { colors } from "../lib/theme";
import type { TasksStackParamList } from "../navigation/types";
import type { HabitRow } from "../types/habit";
import type { Priority, TaskRow } from "../types/task";

type Props = NativeStackScreenProps<TasksStackParamList, "TodayList">;

type HeroReason = "leaving" | "upcoming" | "now" | "overdue" | "priority";
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
  // An event or task that has started but not yet ended (it has a duration) is
  // happening now - not overdue - so it's kept out of this list and shown with
  // the rest of today instead.
  const overdue = rows
    .filter((t) => !t.requires_downtime && t.datetime && new Date(t.datetime) < now && !isInProgress(t, now))
    .sort((a, b) => (a.datetime! < b.datetime! ? -1 : 1));

  const laterToday = rows
    .filter(
      (t) =>
        !t.requires_downtime &&
        t.datetime &&
        (isInProgress(t, now) || (new Date(t.datetime) >= now && new Date(t.datetime) < startOfTomorrow))
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
    heroReason = isInProgress(hero, now) ? "now" : hero.leaving_by ? "leaving" : "upcoming";
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

// Only used for the "flexible" ("When you have time") section - every other
// section already has its own meaningful accent color (overdue/laterToday/
// priority), so recoloring by priority there too would just compete with
// that. Reuses existing theme tokens rather than introducing new hues, same
// reasoning as the rest of this app's palette. A task with no priority counts
// as low (see effectivePriority), so it never reaches the neutral fallback
// below - that's only for a null that isn't a task.
function priorityAccent(priority: Priority | null): { text: string; soft: string } {
  if (priority === "high") return { text: colors.danger, soft: colors.dangerSoft };
  if (priority === "normal") return { text: colors.warning, soft: colors.warningSoft };
  if (priority === "low") return { text: colors.success, soft: colors.successSoft };
  return { text: colors.textSecondary, soft: colors.surfaceAlt };
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
  if (kind === "flexible") return task.datetime ? `Reminder ${formatShortDate(task.datetime)}` : "Set a reminder?";
  return "";
}

function rowPillText(kind: SectionKind, task: TaskRow): string | null {
  if (task.recurring_frequency) return capitalize(task.recurring_frequency);
  if (kind === "overdue" && task.datetime) return formatTime(task.datetime);
  if (kind === "laterToday" && task.datetime) return formatTime(task.datetime);
  return null;
}

export default function TodayScreen({ navigation }: Props) {
  const { recordCompletion, refresh: refreshAccomplishments } = useAccomplishments();
  const habits = useHabits();
  const [allTasks, setAllTasks] = useState<TaskRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // "list" is the grouped to-do view; "day" is a 24-hour calendar grid.
  const [viewMode, setViewMode] = useState<"list" | "day">("list");

  const now = useMemo(() => new Date(), [allTasks]);
  const groups = useMemo(() => buildTodayGroups(allTasks, now), [allTasks, now]);
  const flexibleTiers = useMemo(() => groupFlexibleByPriority(groups.flexibleList), [groups.flexibleList]);

  async function loadTasks(): Promise<TaskRow[]> {
    setError(null);
    const { data, error: fetchError } = await supabase
      .from("tasks")
      .select("*")
      .eq("is_completed", false)
      .order("datetime", { ascending: true, nullsFirst: false });

    if (fetchError) {
      setError(fetchError.message);
      return [];
    }

    const active = await ensureRecurringReminders(await archivePastEvents((data ?? []) as TaskRow[]));
    const refreshed = await refreshUpcomingDepartures(active);
    setAllTasks(refreshed);
    return refreshed;
  }

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      loadTasks().finally(() => setIsLoading(false));
      refreshAccomplishments();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  // Pull-to-refresh is an explicit "where am I right now" signal from the
  // user, unlike the automatic recheck inside refreshUpcomingDepartures
  // (which only recomputes a departure once the event is within
  // DEPARTURE_RECHECK_WINDOW_MINUTES). So a manual refresh always re-anchors
  // the "Next up" hero's departure to the user's current location, no matter
  // how far out the event still is - other tasks are left to the automatic
  // window-based recheck.
  async function refreshHeroDeparture(rows: TaskRow[]) {
    const hero = buildTodayGroups(rows, new Date()).hero;
    if (!hero || !hero.location_raw_text || !hero.datetime) return;

    const userLocation = await getCurrentUserLocation();
    if (!userLocation) return;

    const updated = await updateDepartureForTask(hero, userLocation);
    setAllTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  }

  async function handleRefresh() {
    setIsRefreshing(true);
    habits.reload();
    const rows = await loadTasks();
    await refreshHeroDeparture(rows);
    setIsRefreshing(false);
  }

  async function handleComplete(item: TaskRow) {
    setBusyId(item.id);
    const { next, error: completeError, completed } = await completeTask(item);
    setBusyId(null);

    if (completeError) {
      setError(completeError);
      return;
    }
    if (completed) recordCompletion(item);
    configureRemovalAnimation();
    setAllTasks((prev) => [...prev.filter((t) => t.id !== item.id), ...(next ? [next] : [])]);
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

  function openProfile() {
    navigation.navigate("Profile");
  }

  async function handleHabitCheckIn(habit: HabitRow) {
    const checkInError = await habits.checkIn(habit);
    if (checkInError) Alert.alert("Couldn't check in", checkInError);
  }

  function openHabit(habit: HabitRow) {
    navigation.navigate("HabitDetail", { habit });
  }

  function openTask(item: TaskRow) {
    navigation.navigate("EditTask", { task: item });
  }

  function goToCalendar() {
    // The parent tab navigator doesn't know about "Tasks"'s nested stack
    // screens from here, so this cross-navigator call falls outside what its
    // types can express - same reasoning as goToCapture below, just with the
    // extra nested {screen, params} shape needed to land on a specific screen
    // inside that tab's stack rather than just the tab itself.
    (navigation.getParent() as any)?.navigate("Tasks", {
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

  const habitsSection = (
    <TodayHabitsSection
      statuses={habits.statuses}
      busyIds={habits.busyIds}
      onCheckIn={handleHabitCheckIn}
      onOpen={openHabit}
    />
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable
          style={styles.identity}
          onPress={openProfile}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Open profile"
        >
          <View style={styles.avatar}>
            <Ionicons name="sparkles-outline" size={18} color={colors.accent} />
          </View>
          <View>
            <Text style={styles.appName}>Aidha</Text>
          </View>
        </Pressable>
        <View style={styles.topBarActions}>
          <Pressable onPress={goToCalendar} hitSlop={10}>
            <Ionicons name="calendar-outline" size={22} color={colors.textSecondary} />
          </Pressable>
          <Pressable onPress={openProfile} hitSlop={10} accessibilityRole="button" accessibilityLabel="Profile and settings">
            <Ionicons name="settings-outline" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>

      <View style={styles.modeToggle}>
        {(["list", "day"] as const).map((mode) => (
          <Pressable
            key={mode}
            onPress={() => setViewMode(mode)}
            style={[styles.modeOption, viewMode === mode && styles.modeOptionActive]}
          >
            <Text style={[styles.modeOptionText, viewMode === mode && styles.modeOptionTextActive]}>
              {mode === "list" ? "List" : "Day"}
            </Text>
          </Pressable>
        ))}
      </View>

      {viewMode === "day" ? (
        <DayView onOpenTask={openTask} />
      ) : isLoading ? (
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
            <>
              <View style={styles.emptyState}>
                <Ionicons name="sparkles-outline" size={22} color={colors.textMuted} />
                <Text style={styles.emptyText}>Nothing on deck today. Nice.</Text>
              </View>
              {habitsSection}
            </>
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

              {habitsSection}

              {groups.flexibleList.length > 0 && (
                <View style={styles.section}>
                  <View style={styles.sectionHeaderRow}>
                    <View style={[styles.sectionDot, { backgroundColor: sectionAccent("flexible").text }]} />
                    <Text style={[styles.sectionLabel, { color: sectionAccent("flexible").text }]}>
                      When you have time
                    </Text>
                  </View>
                  <View style={styles.groupCard}>
                    {flexibleTiers.map((tier, tierIndex) => (
                      <View key={tier.key}>
                        <View
                          style={[
                            styles.priorityTierHeader,
                            tierIndex > 0 && styles.priorityTierHeaderDivider,
                          ]}
                        >
                          <Text style={[styles.priorityTierHeaderText, { color: priorityAccent(tier.priority).text }]}>
                            {tier.label}
                          </Text>
                        </View>
                        {tier.items.map((item, index) => (
                          <TaskRowItem
                            key={item.id}
                            kind="flexible"
                            task={item}
                            busy={busyId === item.id}
                            isLast={index === tier.items.length - 1}
                            onOpen={() => openTask(item)}
                            onComplete={() => handleComplete(item)}
                            onSnooze={() => handleSnoozePress(item)}
                          />
                        ))}
                      </View>
                    ))}
                  </View>
                </View>
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
      : reason === "now"
        ? {
            icon: "play-circle-outline" as const,
            text: "Happening now",
            suffix: ` · until ${formatTime(itemEnd(task)!.toISOString())}`,
          }
      : reason === "upcoming"
        ? { icon: "time-outline" as const, text: formatRelative(new Date(task.datetime!), now), suffix: "" }
        : reason === "overdue"
          ? { icon: "alert-circle-outline" as const, text: `Was due ${formatShortDate(task.datetime!)}`, suffix: "" }
          : { icon: "flag-outline" as const, text: "High priority", suffix: " · no time set" };

  const { animatedStyle, playComplete } = useCompleteAnimation();

  return (
    <Animated.View style={[styles.heroCard, animatedStyle]}>
      <View style={styles.heroBar}>
        <View style={styles.heroBarLeft}>
          <Ionicons name="sparkles-outline" size={13} color={colors.onSurfaceInverse} />
          <Text style={styles.heroBarText}>NEXT UP</Text>
        </View>
        {/* Events archive themselves once their time passes (see loadTasks) - */}
        {/* only a task gets a manual complete tap here. */}
        {task.type === "task" && (
          <Pressable
            onPress={() => playComplete(onComplete)}
            disabled={busy}
            hitSlop={8}
            style={styles.heroCheck}
          >
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
            <Text style={styles.heroRowText}>
              {formatTime(task.datetime)}
              {task.duration_minutes ? ` - ${formatTime(itemEnd(task)!.toISOString())}` : ""}
            </Text>
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
    </Animated.View>
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
  // "flexible" rows are colored by priority (checkmark + title); every other
  // section keeps its own fixed section color, as before.
  const accent = kind === "flexible" ? priorityAccent(effectivePriority(task)) : sectionAccent(kind);
  const subtitle = rowSubtitle(kind, task);
  const pillText = rowPillText(kind, task);
  const { animatedStyle, playComplete } = useCompleteAnimation();

  // Events archive themselves once their time passes (see loadTasks) - the
  // avatar stays as a plain icon for them instead of a complete-tap target.
  const avatarIcon = busy ? (
    <ActivityIndicator size="small" color={accent.text} />
  ) : (
    <Ionicons name={rowIcon(kind, task)} size={16} color={accent.text} />
  );

  return (
    <Animated.View style={[styles.row, !isLast && styles.rowDivider, animatedStyle]}>
      {task.type === "task" ? (
        <Pressable
          onPress={() => playComplete(onComplete)}
          disabled={busy}
          style={[styles.rowAvatar, { backgroundColor: accent.soft }]}
        >
          {avatarIcon}
        </Pressable>
      ) : (
        <View style={[styles.rowAvatar, { backgroundColor: accent.soft }]}>{avatarIcon}</View>
      )}
      <Pressable style={styles.rowMain} onPress={onOpen}>
        <Text style={[styles.rowTitle, kind === "flexible" && { color: accent.text }]} numberOfLines={1}>
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
    </Animated.View>
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
  // Segmented List | Day switch under the top bar.
  modeToggle: {
    flexDirection: "row",
    alignSelf: "center",
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 3,
    marginBottom: 8,
  },
  modeOption: {
    paddingVertical: 6,
    paddingHorizontal: 22,
    borderRadius: 13,
  },
  modeOptionActive: {
    backgroundColor: colors.accent,
  },
  modeOptionText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  modeOptionTextActive: {
    color: colors.onSurfaceInverse,
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
  priorityTierHeader: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
  },
  priorityTierHeaderDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  priorityTierHeaderText: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
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

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import BarChart, { type Bar } from "../components/BarChart";
import { monthlyCounts, weeklyCounts, type PeriodCount } from "../lib/accomplishments";
import { useAuth } from "../lib/AuthContext";
import { countUndatedCompletions, fetchCompletionTimes } from "../lib/fetchAccomplishments";
import { colors } from "../lib/theme";
import type { TasksStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<TasksStackParamList, "Profile">;

const WEEKS = 8;
const MONTHS = 6;

interface History {
  weeks: PeriodCount[];
  months: PeriodCount[];
  undated: number;
}

const tasksText = (n: number) => `${n} done`;
const shortDate = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

function weekName(week: PeriodCount, isCurrent: boolean): string {
  return isCurrent ? "This week" : `Week of ${shortDate(week.start)}`;
}

function monthName(month: PeriodCount, isCurrent: boolean): string {
  if (isCurrent) return "This month";
  const sameYear = month.start.getFullYear() === new Date().getFullYear();
  return month.start.toLocaleDateString(undefined, { month: "long", ...(sameYear ? {} : { year: "numeric" }) });
}

// The user's account, plus how many tasks they've checked off and habit
// check-ins they've made each week and each month. Events aren't counted - they archive themselves once their time
// passes, so there's no telling whether the user actually went.
export default function ProfileScreen({ navigation }: Props) {
  const { session } = useAuth();
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Null = the current period (the last bar), so it follows along as time moves.
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const loadId = useRef(0);

  const load = useCallback(async () => {
    const id = ++loadId.current;
    const now = new Date();
    const weeks = weeklyCounts([], now, WEEKS);
    const months = monthlyCounts([], now, MONTHS);
    // One query covering whichever window reaches further back.
    const since = new Date(Math.min(weeks[0].start.getTime(), months[0].start.getTime()));

    const [times, undated] = await Promise.all([fetchCompletionTimes(since), countUndatedCompletions()]);
    if (id !== loadId.current) return;
    if (!times) {
      setError("Couldn't load your progress. Pull down to try again.");
      return;
    }
    setError(null);
    setHistory({
      weeks: weeklyCounts(times, now, WEEKS),
      months: monthlyCounts(times, now, MONTHS),
      undated: undated ?? 0,
    });
  }, []);

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

  const email = session?.user.email ?? "";

  function showTasks(title: string, period: PeriodCount) {
    navigation.navigate("CompletedTasks", {
      title,
      start: period.start.toISOString(),
      end: period.end.toISOString(),
    });
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.accent} />}
    >
      <View style={styles.identity}>
        <View style={styles.avatar}>
          <Ionicons name="person-outline" size={24} color={colors.accent} />
        </View>
        <View style={styles.identityText}>
          <Text style={styles.signedInAs}>Signed in as</Text>
          <Text style={styles.email} numberOfLines={1}>
            {email}
          </Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Tasks & habits done</Text>

      {error && (
        <Pressable onPress={handleRefresh} accessibilityRole="button">
          <Text style={styles.error}>{error}</Text>
        </Pressable>
      )}

      {!history ? (
        !error && (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent} />
          </View>
        )
      ) : (
        <>
          <View style={styles.tiles}>
            <StatTile
              label="This week"
              value={history.weeks[WEEKS - 1].count}
              onPress={() => showTasks("This week", history.weeks[WEEKS - 1])}
            />
            <StatTile
              label="This month"
              value={history.months[MONTHS - 1].count}
              onPress={() => showTasks("This month", history.months[MONTHS - 1])}
            />
          </View>

          <HistoryCard
            title="Weekly"
            periods={history.weeks}
            selected={selectedWeek ?? WEEKS - 1}
            onSelect={(i) => setSelectedWeek(i === WEEKS - 1 ? null : i)}
            name={weekName}
            onShowTasks={showTasks}
            axisLabel={(p) => `${p.start.getMonth() + 1}/${p.start.getDate()}`}
          />
          <HistoryCard
            title="Monthly"
            periods={history.months}
            selected={selectedMonth ?? MONTHS - 1}
            onSelect={(i) => setSelectedMonth(i === MONTHS - 1 ? null : i)}
            name={monthName}
            onShowTasks={showTasks}
            axisLabel={(p) => p.start.toLocaleDateString(undefined, { month: "short" })}
          />

          {history.undated > 0 && (
            <Text style={styles.footnote}>
              {history.undated === 1
                ? "1 task you completed earlier isn't shown - Aidha didn't record when it was done."
                : `${history.undated} tasks you completed earlier aren't shown - Aidha didn't record when they were done.`}
            </Text>
          )}
        </>
      )}
    </ScrollView>
  );
}

function StatTile({ label, value, onPress }: { label: string; value: number; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value} tasks and habit check-ins done`}
      accessibilityHint="Shows what you did"
    >
      <Text style={styles.tileValue}>{value}</Text>
      <View style={styles.tileFooter}>
        <Text style={styles.tileLabel}>{label}</Text>
        <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
      </View>
    </Pressable>
  );
}

function HistoryCard({
  title,
  periods,
  selected,
  onSelect,
  name,
  onShowTasks,
  axisLabel,
}: {
  title: string;
  periods: PeriodCount[];
  selected: number;
  onSelect: (index: number) => void;
  name: (period: PeriodCount, isCurrent: boolean) => string;
  onShowTasks: (title: string, period: PeriodCount) => void;
  axisLabel: (period: PeriodCount) => string;
}) {
  const last = periods.length - 1;
  const bars: Bar[] = useMemo(
    () =>
      periods.map((p, i) => ({
        key: p.start.toISOString(),
        label: axisLabel(p),
        value: p.count,
        accessibilityLabel: `${name(p, i === last)}: ${tasksText(p.count)}`,
      })),
    // name/axisLabel are stable module-level functions or inline lambdas over
    // nothing; the bars only change with the data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [periods, last]
  );
  const current = periods[selected];
  const currentName = name(current, selected === last);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderText}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.readout}>
            {currentName} · <Text style={styles.readoutValue}>{tasksText(current.count)}</Text>
          </Text>
        </View>
        {current.count > 0 && (
          <Pressable
            onPress={() => onShowTasks(currentName, current)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`See what you did: ${currentName}`}
            style={({ pressed }) => [styles.seeTasks, pressed && styles.pressed]}
          >
            <Text style={styles.seeTasksText}>See all</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.accent} />
          </Pressable>
        )}
      </View>
      <BarChart bars={bars} selectedIndex={selected} onSelect={onSelect} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  identityText: {
    flex: 1,
  },
  signedInAs: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  email: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textPrimary,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: colors.textSecondary,
    marginTop: 24,
    marginBottom: 10,
  },
  loading: {
    paddingVertical: 40,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    marginBottom: 12,
  },
  tiles: {
    flexDirection: "row",
    gap: 12,
  },
  tile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  tileValue: {
    fontSize: 32,
    fontWeight: "800",
    color: colors.textPrimary,
    fontVariant: ["tabular-nums"],
  },
  tileFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  tileLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  pressed: {
    opacity: 0.6,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginTop: 12,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  cardHeaderText: {
    flex: 1,
  },
  seeTasks: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 2,
  },
  seeTasksText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.accent,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  readout: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  readoutValue: {
    color: colors.textPrimary,
    fontWeight: "600",
  },
  footnote: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 16,
    lineHeight: 17,
  },
});

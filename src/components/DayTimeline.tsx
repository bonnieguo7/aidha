import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  blockGeometry,
  buildDayBlocks,
  dayMinutes,
  getDayBounds,
  layoutBlocks,
  MINUTES_PER_DAY,
  type BlockGeometry,
  type PositionedBlock,
} from "../lib/dayLayout";
import { itemEnd } from "../lib/duration";
import { colors } from "../lib/theme";
import type { TaskRow } from "../types/task";

const HOUR_HEIGHT = 60;
const PX_PER_MINUTE = HOUR_HEIGHT / 60;
const GRID_HEIGHT = MINUTES_PER_DAY * PX_PER_MINUTE;
const GUTTER_WIDTH = 56;
// Below this a block can't fit a second line, so title and time share one.
const TWO_LINE_MIN_HEIGHT = 44;
// Where an empty past/future day opens, so the working day is in view.
const DEFAULT_SCROLL_MINUTES = 7 * 60;

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatHourLabel(hour: number): string {
  return new Date(2000, 0, 1, hour).toLocaleTimeString(undefined, { hour: "numeric" });
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

interface Props {
  date: Date;
  tasks: TaskRow[];
  isLoaded: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onOpenTask: (task: TaskRow) => void;
}

export default function DayTimeline({ date, tasks, isLoaded, isRefreshing, onRefresh, onOpenTask }: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const [gridWidth, setGridWidth] = useState(0);
  const [now, setNow] = useState(() => new Date());

  // Keeps the "now" line moving without the user having to refresh.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const { start: dayStart, end: dayEnd } = useMemo(() => getDayBounds(date), [date]);
  const blocks = useMemo(
    () => layoutBlocks(buildDayBlocks(tasks, dayStart, dayEnd)),
    [tasks, dayStart, dayEnd]
  );
  const showNowLine = isSameDay(date, now);
  const nowMinutes = dayMinutes(now, dayStart, dayEnd);

  // Once a day's data is in, bring the relevant part of the 24-hour grid into
  // view: the current time for today, otherwise the first thing on that day.
  useEffect(() => {
    if (!isLoaded) return;
    const firstBlockMinutes = blocks.length > 0 ? Math.min(...blocks.map((b) => b.startMinutes)) : null;
    const targetMinutes = showNowLine
      ? nowMinutes - 90
      : firstBlockMinutes !== null
        ? firstBlockMinutes - 60
        : DEFAULT_SCROLL_MINUTES;
    const timer = setTimeout(
      () => scrollRef.current?.scrollTo({ y: Math.max(0, targetMinutes * PX_PER_MINUTE), animated: false }),
      0
    );
    return () => clearTimeout(timer);
    // Re-centering on every data refresh or minute tick would yank the grid
    // out from under a user who's scrolled - only when the day changes (or its
    // data first arrives).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayStart.getTime(), isLoaded]);

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
    >
      <View style={[styles.grid, { height: GRID_HEIGHT }]}>
        {Array.from({ length: 24 }, (_, hour) => (
          <View key={hour} style={[styles.hourRow, { top: hour * HOUR_HEIGHT }]}>
            <Text style={styles.hourLabel}>{hour === 0 ? "" : formatHourLabel(hour)}</Text>
            <View style={styles.hourLine} />
          </View>
        ))}

        <View style={styles.blocksArea} onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}>
          {gridWidth > 0 &&
            blocks.map((block) => (
              <BlockView
                key={block.id}
                block={block}
                geometry={blockGeometry(block, PX_PER_MINUTE, gridWidth)}
                onOpen={() => onOpenTask(block.task)}
              />
            ))}
        </View>

        {showNowLine && (
          <View pointerEvents="none" style={[styles.nowLine, { top: nowMinutes * PX_PER_MINUTE }]}>
            <View style={styles.nowDot} />
            <View style={styles.nowRule} />
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function BlockView({
  block,
  geometry,
  onOpen,
}: {
  block: PositionedBlock;
  geometry: BlockGeometry;
  onOpen: () => void;
}) {
  const { task } = block;
  const done = task.is_completed;
  const roomForTwoLines = geometry.height >= TWO_LINE_MIN_HEIGHT;

  if (block.kind === "travel") {
    const leaveBy = task.leaving_by ? new Date(task.leaving_by) : null;
    return (
      <Pressable onPress={onOpen} style={[styles.block, styles.travelBlock, geometry]}>
        <Ionicons name="car-outline" size={14} color={colors.warning} />
        <Text style={styles.travelText} numberOfLines={roomForTwoLines ? 2 : 1}>
          Leave by {leaveBy ? formatTime(leaveBy) : ""}
          {roomForTwoLines && task.travel_duration_minutes != null ? ` · ${task.travel_duration_minutes} min` : ""}
        </Text>
      </Pressable>
    );
  }

  const isEvent = block.kind === "event";
  // "7:00 PM - 8:30 PM" once it has a duration; just the start otherwise.
  const end = task.duration_minutes ? itemEnd(task) : null;
  const start = task.datetime
    ? formatTime(new Date(task.datetime)) + (end ? ` - ${formatTime(end)}` : "")
    : "";

  return (
    <Pressable
      onPress={onOpen}
      style={[
        styles.block,
        isEvent ? styles.eventBlock : styles.taskBlock,
        done && styles.doneBlock,
        geometry,
      ]}
    >
      <View style={[styles.accentBar, { backgroundColor: isEvent ? colors.accent : colors.success }]} />
      <View style={styles.blockBody}>
        <Text
          style={[styles.blockTitle, done && styles.doneTitle]}
          numberOfLines={roomForTwoLines ? 2 : 1}
        >
          {roomForTwoLines ? task.title : `${task.title} · ${start}`}
        </Text>
        {roomForTwoLines && (
          <Text style={styles.blockMeta} numberOfLines={1}>
            {start}
            {task.location_raw_text ? ` · ${task.location_raw_text}` : ""}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  grid: {
    position: "relative",
    marginTop: 8,
  },
  hourRow: {
    position: "absolute",
    left: 0,
    right: 0,
    height: HOUR_HEIGHT,
    flexDirection: "row",
  },
  hourLabel: {
    width: GUTTER_WIDTH,
    paddingRight: 8,
    textAlign: "right",
    fontSize: 11,
    color: colors.textMuted,
    // Centers the label on the hour line instead of sitting under it.
    marginTop: -7,
  },
  hourLine: {
    flex: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  blocksArea: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: GUTTER_WIDTH,
    right: 16,
  },
  block: {
    position: "absolute",
    borderRadius: 8,
    overflow: "hidden",
    flexDirection: "row",
  },
  eventBlock: {
    backgroundColor: colors.accentSoft,
  },
  taskBlock: {
    backgroundColor: colors.successSoft,
  },
  doneBlock: {
    opacity: 0.55,
  },
  accentBar: {
    width: 4,
  },
  blockBody: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    justifyContent: "flex-start",
  },
  blockTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  doneTitle: {
    textDecorationLine: "line-through",
  },
  blockMeta: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 1,
  },
  travelBlock: {
    alignItems: "flex-start",
    gap: 4,
    padding: 6,
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: colors.warning,
    borderStyle: "dashed",
  },
  travelText: {
    flex: 1,
    fontSize: 11,
    fontWeight: "600",
    color: colors.warning,
  },
  nowLine: {
    position: "absolute",
    left: GUTTER_WIDTH - 5,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    // Centers the 10px dot on the line.
    marginTop: -5,
  },
  nowDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.danger,
  },
  nowRule: {
    flex: 1,
    height: 2,
    backgroundColor: colors.danger,
  },
});

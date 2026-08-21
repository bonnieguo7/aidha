import { Ionicons } from "@expo/vector-icons";
import { useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../lib/theme";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const SWIPE_THRESHOLD = 50;

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// "YYYY-MM-DD" in local time - shared with TaskSectionList so both sides agree
// on which calendar day an event's datetime falls on.
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Sunday-first grid, padded with nulls so every row has 7 cells.
function buildMonthGrid(monthStart: Date): (Date | null)[] {
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  const leadingBlanks = monthStart.getDay();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < leadingBlanks; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(new Date(monthStart.getFullYear(), monthStart.getMonth(), day));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

interface Props {
  eventDates: Set<string>;
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  onMonthChange?: (monthStart: Date) => void;
}

export default function CalendarMonthView({ eventDates, selectedDate, onSelectDate, onMonthChange }: Props) {
  const [monthStart, setMonthStart] = useState(() => startOfMonth(selectedDate));
  const cells = useMemo(() => buildMonthGrid(monthStart), [monthStart]);

  function goToMonth(next: Date) {
    setMonthStart(next);
    onMonthChange?.(next);
  }

  // Kept fresh every render so the PanResponder below - created once via useRef
  // and never recreated - can still always read the latest state/props instead
  // of whatever was current on the render that first constructed it.
  const monthStartRef = useRef(monthStart);
  monthStartRef.current = monthStart;
  const onMonthChangeRef = useRef(onMonthChange);
  onMonthChangeRef.current = onMonthChange;

  // PanResponder (core React Native, no extra gesture library needed) claims the
  // gesture only once a drag is clearly horizontal. This has to be done in the
  // *capture* phase - each day cell is its own Pressable, which grabs the touch
  // responder on press-down, so the bubble-phase "should set" handlers never
  // fire once a drag starts inside a cell. Capture handlers run top-down before
  // that happens, so the parent can still take over mid-drag; a plain tap never
  // crosses the movement threshold, so it reaches the cell's Pressable as usual.
  //
  // Built once via useRef and reused for the component's whole lifetime (so an
  // in-progress gesture never has its native touch tracking reset out from under
  // it by a re-render) - so `next` is computed from monthStartRef rather than a
  // closed-over `monthStart`, which would otherwise stay frozen at whatever
  // render first constructed this responder. setMonthStart is called with that
  // plain value rather than an updater function: an updater runs as part of
  // rendering *this* component, so calling the parent's onMonthChange from
  // inside one trips React's "setState while rendering a different component"
  // check - it has to happen as its own separate statement instead.
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, gesture) =>
        Math.abs(gesture.dx) > 20 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderTerminationRequest: () => true,
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx <= -SWIPE_THRESHOLD) {
          const next = addMonths(monthStartRef.current, 1);
          setMonthStart(next);
          onMonthChangeRef.current?.(next);
        } else if (gesture.dx >= SWIPE_THRESHOLD) {
          const next = addMonths(monthStartRef.current, -1);
          setMonthStart(next);
          onMonthChangeRef.current?.(next);
        }
      },
    })
  ).current;

  const today = new Date();

  return (
    <View>
      <View style={styles.header}>
        <Pressable onPress={() => goToMonth(addMonths(monthStart, -1))} hitSlop={10} style={styles.navButton}>
          <Ionicons name="chevron-back" size={18} color={colors.accent} />
        </Pressable>
        <Text style={styles.monthLabel}>
          {monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </Text>
        <Pressable onPress={() => goToMonth(addMonths(monthStart, 1))} hitSlop={10} style={styles.navButton}>
          <Ionicons name="chevron-forward" size={18} color={colors.accent} />
        </Pressable>
      </View>

      <Pressable
        onPress={() => {
          goToMonth(startOfMonth(today));
          onSelectDate(today);
        }}
        hitSlop={6}
        style={styles.todayLink}
      >
        <Text style={styles.todayLinkText}>Today</Text>
      </Pressable>

      <View {...panResponder.panHandlers}>
        <View style={styles.weekdayRow}>
          {WEEKDAY_LABELS.map((label, i) => (
            <Text key={i} style={styles.weekdayLabel}>
              {label}
            </Text>
          ))}
        </View>
        <View style={styles.grid}>
          {cells.map((cell, index) => {
            if (!cell) return <View key={index} style={styles.cell} />;
            const isToday = isSameDay(cell, today);
            const isSelected = isSameDay(cell, selectedDate);
            const hasEvents = eventDates.has(dateKey(cell));
            return (
              <Pressable key={index} onPress={() => onSelectDate(cell)} style={styles.cell}>
                <View
                  style={[
                    styles.dayCircle,
                    isSelected && styles.dayCircleSelected,
                    !isSelected && isToday && styles.dayCircleToday,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayNumber,
                      isSelected && styles.dayNumberSelected,
                      !isSelected && isToday && styles.dayNumberToday,
                    ]}
                  >
                    {cell.getDate()}
                  </Text>
                </View>
                <View style={[styles.dot, hasEvents && styles.dotVisible]} />
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  navButton: {
    padding: 4,
  },
  monthLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  todayLink: {
    alignSelf: "flex-end",
    marginTop: 4,
    marginBottom: 6,
  },
  todayLinkText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.accent,
  },
  weekdayRow: {
    flexDirection: "row",
  },
  weekdayLabel: {
    flex: 1,
    textAlign: "center",
    fontSize: 11,
    color: colors.textSecondary,
    paddingVertical: 4,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    width: `${100 / 7}%`,
    alignItems: "center",
    paddingVertical: 4,
  },
  dayCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  dayCircleSelected: {
    backgroundColor: colors.accent,
  },
  dayCircleToday: {
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  dayNumber: {
    fontSize: 13,
    color: colors.textPrimary,
  },
  dayNumberSelected: {
    color: colors.onSurfaceInverse,
    fontWeight: "700",
  },
  dayNumberToday: {
    color: colors.accent,
    fontWeight: "600",
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 3,
    backgroundColor: "transparent",
  },
  dotVisible: {
    backgroundColor: colors.accent,
  },
});

import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../lib/theme";

export interface Bar {
  key: string;
  // Short label under the bar ("11/23", "Nov").
  label: string;
  value: number;
  // Read by screen readers, e.g. "Week of Nov 23: 4 tasks".
  accessibilityLabel: string;
}

const PLOT_HEIGHT = 110;
const VALUE_LABEL_HEIGHT = 20;
const MAX_BAR_WIDTH = 28;

// A single-series column chart. Tapping a bar selects it; only the selected bar
// carries its number, so the chart never turns into a wall of figures. Every
// bar is the same accent color - selection shows through the label and a
// stronger axis label, not a color change.
export default function BarChart({
  bars,
  selectedIndex,
  onSelect,
}: {
  bars: Bar[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const max = Math.max(1, ...bars.map((b) => b.value));

  return (
    <View>
      <View style={[styles.plot, { height: PLOT_HEIGHT + VALUE_LABEL_HEIGHT }]}>
        {bars.map((bar, i) => {
          const selected = i === selectedIndex;
          // A non-zero week always gets a sliver, so "1" never looks like "0".
          const height = bar.value === 0 ? 0 : Math.max(4, (bar.value / max) * PLOT_HEIGHT);
          return (
            <Pressable
              key={bar.key}
              style={styles.column}
              onPress={() => onSelect(i)}
              accessibilityRole="button"
              accessibilityLabel={bar.accessibilityLabel}
              accessibilityState={{ selected }}
            >
              {selected && <Text style={styles.valueLabel}>{bar.value}</Text>}
              <View style={[styles.bar, { height }]} />
            </Pressable>
          );
        })}
      </View>
      <View style={styles.baseline} />
      <View style={styles.labels}>
        {bars.map((bar, i) => (
          <Text
            key={bar.key}
            style={[styles.axisLabel, i === selectedIndex && styles.axisLabelSelected]}
            numberOfLines={1}
            importantForAccessibility="no"
            accessibilityElementsHidden
          >
            {bar.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  plot: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  column: {
    flex: 1,
    height: "100%",
    alignItems: "center",
    justifyContent: "flex-end",
    // The 2px gap between neighbouring bars.
    paddingHorizontal: 1,
  },
  bar: {
    width: "70%",
    maxWidth: MAX_BAR_WIDTH,
    backgroundColor: colors.accent,
    // Rounded at the data end only; square where it meets the baseline.
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  valueLabel: {
    height: VALUE_LABEL_HEIGHT,
    fontSize: 13,
    fontWeight: "700",
    color: colors.textPrimary,
    fontVariant: ["tabular-nums"],
  },
  baseline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  labels: {
    flexDirection: "row",
    marginTop: 6,
  },
  axisLabel: {
    flex: 1,
    textAlign: "center",
    fontSize: 11,
    color: colors.textMuted,
  },
  axisLabelSelected: {
    color: colors.textSecondary,
    fontWeight: "600",
  },
});

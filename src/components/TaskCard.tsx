import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../lib/theme";
import type { ClarificationField, ParsedTask } from "../types/task";

function formatDatetime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const datePart = date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timePart = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${datePart} · ${timePart}`;
}

interface RowProps {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  flagged: boolean;
}

function Row({ icon, text, flagged }: RowProps) {
  return (
    <View style={styles.row}>
      <Ionicons
        name={icon}
        size={16}
        color={flagged ? colors.warning : colors.textSecondary}
        style={styles.rowIcon}
      />
      <Text style={[styles.rowText, flagged && styles.rowTextFlagged]}>{text}</Text>
      {flagged && <Text style={styles.flagBadge}>needs clarification</Text>}
    </View>
  );
}

export default function TaskCard({ task }: { task: ParsedTask }) {
  const flags = task.needs_clarification ?? [];
  const isFlagged = (field: ClarificationField) => flags.includes(field);

  const showWhen = Boolean(task.datetime) || task.date_certainty !== "none" || isFlagged("datetime");
  const whenText = task.datetime
    ? formatDatetime(task.datetime)
    : task.date_certainty === "approximate"
      ? "Soon (no fixed time)"
      : "No deadline set";

  const showLocation = Boolean(task.location) || isFlagged("location");
  const showPriority = Boolean(task.priority) || isFlagged("priority");
  const showRecurrence = Boolean(task.recurring) || isFlagged("recurrence");

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>{task.title}</Text>
        <View style={styles.typeBadge}>
          <Text style={styles.typeBadgeText}>{task.type}</Text>
        </View>
      </View>

      {showLocation && (
        <Row
          icon="location-outline"
          text={task.location ? task.location.raw_text : "Location unclear"}
          flagged={isFlagged("location")}
        />
      )}

      {showWhen && <Row icon="calendar-outline" text={whenText} flagged={isFlagged("datetime")} />}

      {showPriority && (
        <Row
          icon="flag-outline"
          text={task.priority ? `${task.priority} priority` : "Priority unclear"}
          flagged={isFlagged("priority")}
        />
      )}

      {showRecurrence && (
        <Row
          icon="repeat-outline"
          text={
            task.recurring
              ? `Repeats ${task.recurring.frequency} (${task.recurring.interval_detail})`
              : "Recurrence unclear"
          }
          flagged={isFlagged("recurrence")}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    flexShrink: 1,
    marginRight: 8,
    color: colors.textPrimary,
  },
  typeBadge: {
    backgroundColor: colors.accentSoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  typeBadgeText: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 5,
    flexWrap: "wrap",
  },
  rowIcon: {
    marginRight: 8,
  },
  rowText: {
    fontSize: 14,
    color: colors.textPrimary,
  },
  rowTextFlagged: {
    color: colors.warning,
    fontWeight: "500",
  },
  flagBadge: {
    marginLeft: 8,
    fontSize: 11,
    color: colors.warning,
    backgroundColor: colors.warningSoft,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: "hidden",
  },
});

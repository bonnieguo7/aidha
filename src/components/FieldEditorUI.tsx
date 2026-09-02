import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../lib/theme";

// Shared field-row/segmented-control UI, originally built for EditTaskScreen's
// per-field editors and extracted here so the pre-save task editor (NewTaskScreen)
// can reuse the same look without duplicating it.

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={fieldEditorStyles.segmentedControl}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[fieldEditorStyles.segment, selected && fieldEditorStyles.segmentSelected]}
          >
            <Text style={[fieldEditorStyles.segmentText, selected && fieldEditorStyles.segmentTextSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function EditorActions({
  onSave,
  onCancel,
  saving,
}: {
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <View style={fieldEditorStyles.editorActionsRow}>
      <Pressable
        onPress={onSave}
        disabled={saving}
        style={[fieldEditorStyles.saveChip, saving && fieldEditorStyles.buttonDisabled]}
      >
        {saving ? (
          <ActivityIndicator color={colors.onSurfaceInverse} size="small" />
        ) : (
          <Text style={fieldEditorStyles.saveChipText}>Save</Text>
        )}
      </Pressable>
      <Pressable onPress={onCancel} disabled={saving} hitSlop={8}>
        <Text style={fieldEditorStyles.cancelLink}>Cancel</Text>
      </Pressable>
    </View>
  );
}

export function FieldRow({
  icon,
  iconBackground,
  iconColor = colors.textSecondary,
  label,
  value,
  valueColor,
  expanded,
  onToggle,
  bordered = true,
  readOnly = false,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconBackground?: string;
  iconColor?: string;
  label: string;
  value: string;
  valueColor?: string;
  expanded: boolean;
  onToggle: () => void;
  bordered?: boolean;
  readOnly?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <View style={[fieldEditorStyles.fieldRow, bordered && fieldEditorStyles.fieldRowBorder]}>
      <Pressable style={fieldEditorStyles.fieldRowHeader} onPress={onToggle} disabled={readOnly}>
        <View style={[fieldEditorStyles.fieldIcon, iconBackground ? { backgroundColor: iconBackground } : null]}>
          <Ionicons name={icon} size={16} color={iconColor} />
        </View>
        <View style={fieldEditorStyles.fieldRowText}>
          <Text style={fieldEditorStyles.fieldRowLabel}>{label}</Text>
          <Text style={[fieldEditorStyles.fieldRowValue, valueColor ? { color: valueColor } : null]} numberOfLines={1}>
            {value}
          </Text>
        </View>
        {!readOnly && <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
      </Pressable>
      {expanded && <View style={fieldEditorStyles.fieldEditor}>{children}</View>}
    </View>
  );
}

export const fieldEditorStyles = StyleSheet.create({
  detailsCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 14,
    overflow: "hidden",
  },
  fieldRow: {
    paddingHorizontal: 12,
  },
  fieldRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  fieldRowHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 12,
  },
  fieldIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldRowText: {
    flex: 1,
  },
  fieldRowLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  fieldRowValue: {
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: "500",
    marginTop: 1,
  },
  fieldEditor: {
    paddingBottom: 14,
  },
  inlineEditorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
  },
  inlineInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    color: colors.textPrimary,
  },
  recurrenceDetailInput: {
    marginTop: 10,
  },
  segmentedControl: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  segment: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  segmentText: {
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: "500",
  },
  segmentTextSelected: {
    color: colors.onSurfaceInverse,
  },
  editorActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginTop: 10,
  },
  saveChip: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  saveChipText: {
    color: colors.onSurfaceInverse,
    fontSize: 14,
    fontWeight: "600",
  },
  cancelLink: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});

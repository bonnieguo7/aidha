import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { Platform, Pressable, StyleSheet, Text } from "react-native";
import { colors } from "../lib/theme";

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function dateStringToDate(date: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function dateToDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// A real calendar-grid date picker (inline month view on iOS, the native
// calendar dialog on Android) in place of a free-text YYYY-MM-DD field.
// `value`/`onChange` still speak plain "YYYY-MM-DD" strings so callers don't
// need to change their draft state or save/cancel handling - only the input
// widget changes.
export default function DatePickerField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const dateValue = dateStringToDate(value);

  if (Platform.OS === "android") {
    return (
      <Pressable
        style={datePickerFieldStyles.androidTrigger}
        onPress={() =>
          DateTimePickerAndroid.open({
            value: dateValue,
            mode: "date",
            onChange: (_event, selected) => {
              if (selected) onChange(dateToDateString(selected));
            },
          })
        }
      >
        <Text style={datePickerFieldStyles.androidTriggerText}>
          {dateValue.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
        </Text>
      </Pressable>
    );
  }

  return (
    <DateTimePicker
      value={dateValue}
      mode="date"
      display="inline"
      themeVariant="light"
      accentColor={colors.accent}
      onChange={(_event, selected) => {
        if (selected) onChange(dateToDateString(selected));
      }}
    />
  );
}

const datePickerFieldStyles = StyleSheet.create({
  androidTrigger: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  androidTriggerText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textPrimary,
  },
});

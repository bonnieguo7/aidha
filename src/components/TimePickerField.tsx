import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { Platform, Pressable, StyleSheet, Text } from "react-native";
import { colors } from "../lib/theme";

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function timeStringToDate(time: string): Date {
  const base = new Date();
  const match = /^(\d{2}):(\d{2})$/.exec(time.trim());
  base.setHours(match ? Number(match[1]) : 9, match ? Number(match[2]) : 0, 0, 0);
  return base;
}

function dateToTimeString(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// A real time-of-day picker (spinner on iOS, the native clock dialog on
// Android) in place of a free-text HH:MM field. `value`/`onChange` still
// speak plain "HH:MM" strings so callers don't need to change their draft
// state or save/cancel handling - only the input widget changes.
export default function TimePickerField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const dateValue = timeStringToDate(value);

  if (Platform.OS === "android") {
    return (
      <Pressable
        style={timePickerFieldStyles.androidTrigger}
        onPress={() =>
          DateTimePickerAndroid.open({
            value: dateValue,
            mode: "time",
            is24Hour: false,
            onChange: (_event, selected) => {
              if (selected) onChange(dateToTimeString(selected));
            },
          })
        }
      >
        <Text style={timePickerFieldStyles.androidTriggerText}>
          {dateValue.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
        </Text>
      </Pressable>
    );
  }

  return (
    <DateTimePicker
      value={dateValue}
      mode="time"
      display="spinner"
      themeVariant="light"
      onChange={(_event, selected) => {
        if (selected) onChange(dateToTimeString(selected));
      }}
    />
  );
}

const timePickerFieldStyles = StyleSheet.create({
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

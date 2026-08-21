import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "../lib/AuthContext";
import { localIsoNow, localNaiveToUtcIso } from "../lib/localDatetime";
import { getCurrentUserLocation } from "../lib/locationPermission";
import { updateDepartureForTask } from "../lib/scheduleDeparture";
import { supabase } from "../lib/supabase";
import { colors } from "../lib/theme";
import type { ConversationTurn, ParsedTask, ParseTaskResponse, TaskRow } from "../types/task";
import TaskCard from "../components/TaskCard";

const OPENING_QUESTION = "What do you need to remember?";
const CONFIRMATION_MESSAGE = "Got it, here's what I've got:";

function AssistantBubble({ children }: { children: React.ReactNode }) {
  return (
    <View style={[styles.bubble, styles.bubbleAssistant]}>{children}</View>
  );
}

export default function NewTaskScreen() {
  const { session } = useAuth();
  const [messages, setMessages] = useState<ConversationTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [result, setResult] = useState<ParsedTask | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    if (!draft.trim()) return;
    const nextMessages: ConversationTurn[] = [...messages, { role: "user", content: draft.trim() }];
    setMessages(nextMessages);
    setDraft("");
    setError(null);
    setIsSending(true);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("parse-task", {
        body: {
          messages: nextMessages,
          current_datetime: localIsoNow(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });

      if (fnError) throw fnError;
      const response = data as ParseTaskResponse;

      if (response.type === "question") {
        setMessages([...nextMessages, { role: "assistant", content: response.question }]);
      } else {
        setResult(response.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse task.");
    } finally {
      setIsSending(false);
    }
  }

  async function handleSave() {
    if (!result || !session) return;
    setIsSaving(true);
    setError(null);

    const { data: inserted, error: insertError } = await supabase
      .from("tasks")
      .insert({
        user_id: session.user.id,
        raw_input: messages.find((m) => m.role === "user")?.content ?? "",
        type: result.type,
        title: result.title,
        datetime: result.datetime ? localNaiveToUtcIso(result.datetime) : null,
        date_certainty: result.date_certainty,
        location_raw_text: result.location?.raw_text ?? null,
        location_place_type: result.location?.place_type ?? null,
        recurring_frequency: result.recurring?.frequency ?? null,
        recurring_detail: result.recurring?.interval_detail ?? null,
        priority: result.priority,
        requires_downtime: result.requires_downtime,
      })
      .select()
      .single();

    if (insertError) {
      setIsSaving(false);
      setError(insertError.message);
      return;
    }

    // A location + time is exactly what a "leaving by" reminder needs - compute
    // and schedule it now rather than waiting for the user to open the task again.
    let departureSkipped = false;
    if (result.location && result.datetime) {
      const userLocation = await getCurrentUserLocation();
      if (userLocation) {
        await updateDepartureForTask(inserted as TaskRow, userLocation);
      } else {
        // Permission denied or the device couldn't get a fix - the task still
        // saves fine, but silently skipping this without telling the user
        // means the "leaving by" reminder just never shows up with no
        // explanation. Surface it now, and point at the retry path.
        departureSkipped = true;
      }
    }

    setIsSaving(false);
    Alert.alert(
      "Saved",
      departureSkipped
        ? "Task saved. Couldn't access your location, so a \"leaving by\" reminder wasn't set up - enable location access and retry from the task's edit screen."
        : "Task saved successfully."
    );
    setMessages([]);
    setResult(null);
    setDraft("");
  }

  function handleStartOver() {
    setMessages([]);
    setResult(null);
    setDraft("");
    setError(null);
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <ScrollView contentContainerStyle={styles.chatContent} keyboardShouldPersistTaps="handled">
        <AssistantBubble>
          <Text style={styles.bubbleTextAssistant}>{OPENING_QUESTION}</Text>
        </AssistantBubble>

        {messages.map((message, index) =>
          message.role === "user" ? (
            <View key={index} style={[styles.bubble, styles.bubbleUser]}>
              <Text style={styles.bubbleTextUser}>{message.content}</Text>
            </View>
          ) : (
            <AssistantBubble key={index}>
              <Text style={styles.bubbleTextAssistant}>{message.content}</Text>
            </AssistantBubble>
          )
        )}

        {isSending && (
          <AssistantBubble>
            <ActivityIndicator size="small" color={colors.textSecondary} />
          </AssistantBubble>
        )}

        {result && (
          <AssistantBubble>
            <Text style={styles.bubbleTextAssistant}>{result.confirmation_note ?? CONFIRMATION_MESSAGE}</Text>
            <View style={styles.cardWrap}>
              <TaskCard task={result} />
            </View>
          </AssistantBubble>
        )}

        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>

      {result ? (
        <View style={styles.actionsBar}>
          <Pressable onPress={handleStartOver} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Start a new task</Text>
          </Pressable>
          <Pressable
            onPress={handleSave}
            disabled={isSaving}
            style={[styles.primaryButton, isSaving && styles.buttonDisabled]}
          >
            {isSaving ? (
              <ActivityIndicator color={colors.onSurfaceInverse} size="small" />
            ) : (
              <Text style={styles.primaryButtonText}>Save</Text>
            )}
          </Pressable>
        </View>
      ) : (
        <View style={styles.inputBar}>
          <TextInput
            style={styles.replyInput}
            placeholder="Reply..."
            placeholderTextColor={colors.textMuted}
            value={draft}
            onChangeText={setDraft}
            multiline
          />
          <Pressable
            onPress={handleSend}
            disabled={isSending || !draft.trim()}
            style={[styles.sendButton, (isSending || !draft.trim()) && styles.buttonDisabled]}
          >
            <Ionicons name="arrow-up" size={18} color={colors.onSurfaceInverse} />
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  chatContent: {
    padding: 16,
    paddingBottom: 24,
  },
  bubble: {
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 10,
    maxWidth: "82%",
  },
  bubbleAssistant: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: "flex-start",
  },
  bubbleUser: {
    backgroundColor: colors.accentDark,
    alignSelf: "flex-end",
  },
  bubbleTextAssistant: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 21,
  },
  bubbleTextUser: {
    color: colors.onSurfaceInverse,
    fontSize: 16,
    lineHeight: 21,
  },
  cardWrap: {
    marginTop: 10,
  },
  error: {
    color: colors.danger,
    marginTop: 8,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  replyInput: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    maxHeight: 100,
    marginRight: 10,
    color: colors.textPrimary,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  actionsBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    gap: 12,
  },
  secondaryButton: {
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  secondaryButtonText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: colors.onSurfaceInverse,
    fontSize: 16,
    fontWeight: "600",
  },
});

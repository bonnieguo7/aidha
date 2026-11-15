import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useState } from "react";
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
import { fetchRecentLocations } from "../lib/recentLocations";
import { updateDepartureForTask } from "../lib/scheduleDeparture";
import { supabase } from "../lib/supabase";
import { syncDueNotification } from "../lib/syncDueNotification";
import { colors } from "../lib/theme";
import type { ConversationTurn, ParsedTask, ParseTaskResponse, TaskRow } from "../types/task";
import TaskCard from "../components/TaskCard";
import PendingTaskFields from "../components/PendingTaskFields";

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
  // Likely answers the model offered for its latest question, shown as
  // tappable buttons above the input bar. Purely a shortcut - the text field
  // is always available for a different answer.
  const [suggestions, setSuggestions] = useState<string[]>([]);
  // The user's usual places, offered as the answer buttons whenever the model
  // asks where something is. Kept on the device - never sent to the model.
  const [recentLocations, setRecentLocations] = useState<string[]>([]);

  useFocusEffect(
    useCallback(() => {
      fetchRecentLocations().then(setRecentLocations);
    }, [])
  );
  // Whether the pending task's field editor is open beneath its card - toggled
  // by the pencil icon beside the card, independent of confirming/saving it.
  const [isEditingResult, setIsEditingResult] = useState(false);

  // Shared by both a typed reply and a tapped suggestion - either way, the
  // new turn already has its content decided by the caller, this just sends
  // the updated conversation and handles whatever comes back.
  async function sendMessages(nextMessages: ConversationTurn[]) {
    setError(null);
    setSuggestions([]);
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
        // For "where is it?", only ever the user's own places - the model's
        // list is ignored so it can't put an invented place on a button.
        setSuggestions(response.topic === "location" ? recentLocations : (response.suggestions ?? []));
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

  function handleSend() {
    if (!draft.trim()) return;
    const nextMessages: ConversationTurn[] = [...messages, { role: "user", content: draft.trim() }];
    setMessages(nextMessages);
    setDraft("");
    sendMessages(nextMessages);
  }

  function handleSuggestionSelect(suggestion: string) {
    const nextMessages: ConversationTurn[] = [...messages, { role: "user", content: suggestion }];
    setMessages(nextMessages);
    setDraft("");
    sendMessages(nextMessages);
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
        duration_minutes: result.type === "event" ? result.duration_minutes : null,
      })
      .select()
      .single();

    if (insertError) {
      setIsSaving(false);
      setError(insertError.message);
      return;
    }

    // Independent of the location-based "leaving by" reminder below - this one
    // just fires at the task/event's own time, so it applies whenever there's
    // a datetime at all, location or not.
    if (result.datetime) {
      await syncDueNotification(inserted as TaskRow);
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
    setIsEditingResult(false);
  }

  function handleStartOver() {
    setMessages([]);
    setResult(null);
    setDraft("");
    setError(null);
    setSuggestions([]);
    setIsEditingResult(false);
  }

  const showSuggestions = suggestions.length > 0 && !isSending;

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
          <View style={styles.resultSection}>
            <View style={styles.introRow}>
              <View style={[styles.bubble, styles.bubbleAssistant, styles.resultBubble]}>
                <Text style={styles.bubbleTextAssistant}>{result.confirmation_note ?? CONFIRMATION_MESSAGE}</Text>
                {!isEditingResult && (
                  <View style={styles.cardWrap}>
                    <TaskCard task={result} />
                  </View>
                )}
              </View>
              <View style={styles.cardActionsColumn}>
                <Pressable
                  onPress={() => setIsEditingResult((prev) => !prev)}
                  style={styles.cardActionButton}
                  hitSlop={4}
                >
                  <Ionicons
                    name={isEditingResult ? "close-outline" : "pencil-outline"}
                    size={16}
                    color={colors.textSecondary}
                  />
                </Pressable>
                <Pressable
                  onPress={handleSave}
                  disabled={isSaving}
                  style={[styles.cardActionButton, styles.cardActionConfirm, isSaving && styles.buttonDisabled]}
                  hitSlop={4}
                >
                  {isSaving ? (
                    <ActivityIndicator color={colors.onSurfaceInverse} size="small" />
                  ) : (
                    <Ionicons name="checkmark" size={18} color={colors.onSurfaceInverse} />
                  )}
                </Pressable>
              </View>
            </View>

            {isEditingResult && (
              <View style={styles.editorWrap}>
                <PendingTaskFields task={result} onChange={setResult} />
              </View>
            )}
          </View>
        )}

        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>

      {result ? (
        <View style={styles.actionsBar}>
          <Pressable onPress={handleStartOver} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Start a new task</Text>
          </Pressable>
        </View>
      ) : (
        <View>
          {showSuggestions && (
            <View style={styles.suggestionsBar}>
              {suggestions.map((suggestion) => (
                <Pressable
                  key={suggestion}
                  onPress={() => handleSuggestionSelect(suggestion)}
                  style={styles.suggestionChip}
                >
                  <Text style={styles.suggestionChipText}>{suggestion}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <View style={[styles.inputBar, showSuggestions && styles.inputBarUnderSuggestions]}>
            <TextInput
              style={styles.replyInput}
              placeholder={suggestions.length > 0 ? "Or type your own..." : "Reply..."}
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
  resultSection: {
    marginBottom: 10,
  },
  introRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    maxWidth: "86%",
    gap: 8,
  },
  resultBubble: {
    maxWidth: "100%",
    flexShrink: 1,
    marginBottom: 0,
  },
  cardWrap: {
    marginTop: 10,
  },
  cardActionsColumn: {
    gap: 8,
    paddingTop: 2,
  },
  cardActionButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  cardActionConfirm: {
    backgroundColor: colors.success,
  },
  editorWrap: {
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
    paddingTop: 10,
    // Extra bottom padding beyond paddingTop's 10 - KeyboardAvoidingView
    // otherwise docks this bar flush against the top of the keyboard with
    // no breathing room.
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  // The suggestions bar above already draws the divider line.
  inputBarUnderSuggestions: {
    borderTopWidth: 0,
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
  suggestionsBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 2,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  suggestionChip: {
    backgroundColor: colors.accentSoft,
    borderRadius: 18,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  suggestionChipText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  actionsBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryButton: {
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  secondaryButtonText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
});

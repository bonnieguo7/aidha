import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation, type NavigationProp, type ParamListBase } from "@react-navigation/native";
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
import { canSaveManualTask, createBlankTask, finalizeManualTask } from "../lib/manualTask";
import { effectivePriority } from "../lib/priority";
import { fetchRecentLocations } from "../lib/recentLocations";
import { updateDepartureForTask } from "../lib/scheduleDeparture";
import { supabase } from "../lib/supabase";
import { syncDueNotification } from "../lib/syncDueNotification";
import { colors } from "../lib/theme";
import type { ConversationTurn, ParsedTask, ParseTaskResponse, TaskRow } from "../types/task";
import TaskCard from "../components/TaskCard";
import PendingTaskFields from "../components/PendingTaskFields";

const OPENING_QUESTION = "What's on your mind?";
const CONFIRMATION_MESSAGE = "Got it, here's what I've got:";

function AssistantBubble({ children }: { children: React.ReactNode }) {
  return (
    <View style={[styles.bubble, styles.bubbleAssistant]}>{children}</View>
  );
}

export default function NewTaskScreen() {
  const { session } = useAuth();
  // This tab sits beside the Today/Tasks stacks rather than inside one, so
  // reaching a task's detail screen is a cross-navigator call (see openSavedTask).
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
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
  // Manual mode: the user fills in the fields themselves instead of chatting.
  const [isManual, setIsManual] = useState(false);
  const [manualTask, setManualTask] = useState<ParsedTask>(createBlankTask);

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

  // Saves a finished task and sets up its reminders. Shared by the AI chat flow
  // and the manual form, so a hand-built task gets exactly the same "at the
  // time" and "leaving by" reminders. Returns the saved row (as it stands after
  // the reminders were set up, so it already has its leaving-by time), or null
  // if it couldn't be saved.
  async function saveTask(task: ParsedTask, rawInput: string): Promise<TaskRow | null> {
    if (!session) return null;
    setIsSaving(true);
    setError(null);

    const { data: inserted, error: insertError } = await supabase
      .from("tasks")
      .insert({
        user_id: session.user.id,
        raw_input: rawInput,
        type: task.type,
        title: task.title,
        datetime: task.datetime ? localNaiveToUtcIso(task.datetime) : null,
        date_certainty: task.date_certainty,
        location_raw_text: task.location?.raw_text ?? null,
        location_place_type: task.location?.place_type ?? null,
        recurring_frequency: task.recurring?.frequency ?? null,
        recurring_detail: task.recurring?.interval_detail ?? null,
        priority: effectivePriority(task),
        requires_downtime: task.requires_downtime,
        duration_minutes: task.duration_minutes,
        notes: task.notes?.trim() || null,
      })
      .select()
      .single();

    if (insertError) {
      setIsSaving(false);
      setError(insertError.message);
      return null;
    }

    let saved = inserted as TaskRow;

    // Independent of the location-based "leaving by" reminder below - this one
    // just fires at the task/event's own time, so it applies whenever there's
    // a datetime at all, location or not.
    if (task.datetime) {
      saved = await syncDueNotification(saved);
    }

    // A location + time is exactly what a "leaving by" reminder needs - compute
    // and schedule it now rather than waiting for the user to open the task again.
    let departureSkipped = false;
    if (task.location && task.datetime) {
      const userLocation = await getCurrentUserLocation();
      if (userLocation) {
        saved = await updateDepartureForTask(saved, userLocation);
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
    return saved;
  }

  // Opens the saved task's detail screen. It lives in the Tasks tab's stack
  // (initial: false keeps the Tasks list underneath, so Back returns to the list
  // with the new task in it). The reset above means coming back to this tab
  // later starts a fresh conversation.
  function openSavedTask(task: TaskRow) {
    navigation.navigate("Tasks", { screen: "EditTask", params: { task }, initial: false });
  }

  function resetScreen() {
    setMessages([]);
    setResult(null);
    setDraft("");
    setError(null);
    setSuggestions([]);
    setIsEditingResult(false);
    setIsManual(false);
    setManualTask(createBlankTask());
  }

  async function handleSave() {
    if (!result) return;
    const firstMessage = messages.find((m) => m.role === "user")?.content ?? "";
    const saved = await saveTask(result, firstMessage);
    if (saved) {
      resetScreen();
      openSavedTask(saved);
    }
  }

  async function handleSaveManual() {
    if (!canSaveManualTask(manualTask)) return;
    const task = finalizeManualTask(manualTask);
    // There's no message to record as the original input, so the title stands in.
    const saved = await saveTask(task, task.title);
    if (saved) {
      resetScreen();
      openSavedTask(saved);
    }
  }

  function handleStartOver() {
    resetScreen();
  }

  const showSuggestions = suggestions.length > 0 && !isSending;

  if (isManual) {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <ScrollView contentContainerStyle={styles.chatContent} keyboardShouldPersistTaps="handled">
          <TextInput
            style={styles.manualTitleInput}
            placeholder="What do you need to do?"
            placeholderTextColor={colors.textMuted}
            value={manualTask.title}
            onChangeText={(title) => setManualTask((prev) => ({ ...prev, title }))}
            autoFocus
            multiline
          />
          <View style={styles.editorWrap}>
            <PendingTaskFields
              task={manualTask}
              onChange={setManualTask}
              hideTitle
              locationSuggestions={recentLocations}
            />
          </View>
          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>

        <View style={styles.manualActionsBar}>
          <Pressable onPress={resetScreen} disabled={isSaving} hitSlop={8}>
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={handleSaveManual}
            disabled={isSaving || !canSaveManualTask(manualTask)}
            style={[
              styles.manualSaveButton,
              (isSaving || !canSaveManualTask(manualTask)) && styles.buttonDisabled,
            ]}
          >
            {isSaving ? (
              <ActivityIndicator color={colors.onSurfaceInverse} size="small" />
            ) : (
              <Text style={styles.manualSaveButtonText}>Save</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
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

        {messages.length === 0 && !result && !isSending && (
          <>
            <Pressable onPress={() => setIsManual(true)} style={styles.manualEntry} hitSlop={8}>
              <Ionicons name="create-outline" size={16} color={colors.accent} />
              <Text style={styles.manualEntryText}>Or fill in the details yourself</Text>
            </Pressable>
            {/* Habits have their own tab, so the chat stays about tasks and events. */}
            <Pressable
              onPress={() => navigation.navigate("Habits", { screen: "NewHabit", initial: false })}
              style={styles.habitHint}
              hitSlop={8}
            >
              <Ionicons name="flame-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.habitHintText}>
                Building a habit? <Text style={styles.habitHintLink}>Start one in Habits</Text>
              </Text>
            </Pressable>
          </>
        )}

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
                <PendingTaskFields task={result} onChange={setResult} locationSuggestions={recentLocations} />
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
  manualEntry: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingVertical: 6,
    marginBottom: 10,
  },
  habitHint: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingVertical: 6,
    marginBottom: 10,
  },
  habitHintText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  habitHintLink: {
    color: colors.accent,
    fontWeight: "600",
  },
  manualEntryText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: "600",
  },
  manualTitleInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
    fontWeight: "600",
    color: colors.textPrimary,
    minHeight: 56,
  },
  manualActionsBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  manualSaveButton: {
    backgroundColor: colors.accent,
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  manualSaveButtonText: {
    color: colors.onSurfaceInverse,
    fontSize: 16,
    fontWeight: "600",
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

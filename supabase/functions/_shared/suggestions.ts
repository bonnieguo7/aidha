const MAX_SUGGESTIONS = 4;
// A chip longer than this wraps into a paragraph - the model is asked for short
// labels, and anything over this is more likely a mistake than a useful reply.
const MAX_SUGGESTION_LENGTH = 40;

// Options that don't answer the question but ask for more detail ("By a
// specific date", "Other") - the text box already covers that, and tapping one
// would just send a non-answer. The prompt forbids them, but a model reminder
// isn't a guarantee, so they're also filtered here.
const META_OPTION = /^(other|custom|something else)\b|\b(specific (date|time|day)|pick a|choose a|select a)\b/i;

// Windows too vague to turn into a reminder time ("This weekend", "Later"):
// tapping one would just prompt a follow-up asking which day, the opposite of
// saving the user typing. Also forbidden in the prompt, also filtered here.
const VAGUE_WINDOW = /^(later|soon|sometime|someday|(this|next) (week|weekend|month|year))\b/i;

// The model's suggested_replies end up as tappable buttons whose label is sent
// back verbatim as the user's message, so they're cleaned up here rather than
// trusted: non-strings, blanks, over-long labels, meta-options, vague windows
// and case-insensitive duplicates are dropped, and the list is capped.
export function sanitizeSuggestions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const suggestions: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const label = item.trim();
    if (!label || label.length > MAX_SUGGESTION_LENGTH || META_OPTION.test(label) || VAGUE_WINDOW.test(label)) continue;

    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    suggestions.push(label);
    if (suggestions.length === MAX_SUGGESTIONS) break;
  }
  return suggestions;
}

export type QuestionTopic = "time" | "location" | "recurrence" | "priority" | "other";

// The model tags each question with what it's asking for, but doesn't reliably
// tag "Where do you need to catch the bus?" as a location question. The app
// acts on "location" (it offers the user's own saved places), so a question
// that plainly starts with "Where" is treated as one regardless of the tag.
export function resolveTopic(question: string, modelTopic: QuestionTopic): QuestionTopic {
  return /^\s*where\b/i.test(question) ? "location" : modelTopic;
}

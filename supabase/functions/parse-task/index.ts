import { z } from "https://esm.sh/zod@3.23.8";
import { corsHeaders } from "../_shared/cors.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_USER_TURNS = 4;

const EXTRACT_TASK_TOOL = {
  name: "extract_task",
  description: "Extract a structured task or event from a user's free-text input.",
  input_schema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["event", "task"],
        description:
          "'event' = has a fixed time/place the user must physically attend. 'task' = an action item, may or may not have a location or deadline.",
      },
      title: {
        type: "string",
        description: "Short human-readable label, e.g. 'Dinner at Crown Shy' or 'Pay utility bill'.",
      },
      datetime: {
        type: ["string", "null"],
        description:
          "Local wall-clock datetime as 'YYYY-MM-DDTHH:mm:ss' (no timezone offset, no trailing 'Z') if an exact time was given or can be resolved from the injected current date. Null if no time was mentioned. EXCEPTION: if you are setting booking_travel_datetime below, leave this null instead - the app computes it, since exact date arithmetic is not something you should do by hand.",
      },
      date_certainty: {
        type: "string",
        enum: ["exact", "approximate", "none"],
        description:
          "'exact' = specific date/time given. 'approximate' = vague urgency like 'ASAP' or 'soon'. 'none' = no deadline implied at all.",
      },
      location: {
        type: ["object", "null"],
        properties: {
          raw_text: { type: "string" },
          place_type: {
            type: "string",
            enum: ["specific_address", "known_place", "category", "none"],
          },
        },
        description: "Null if no location is implied by the task.",
      },
      recurring: {
        type: ["object", "null"],
        properties: {
          frequency: { type: "string", enum: ["daily", "weekly", "monthly", "yearly"] },
          interval_detail: { type: "string", description: "e.g. 'day_of_month:1' or 'day_of_week:monday'" },
        },
        description: "Null if not recurring.",
      },
      priority: {
        type: ["string", "null"],
        enum: ["high", "normal", "low", null],
      },
      requires_downtime: {
        type: "boolean",
        description:
          "Whether this task should surface during free time rather than at a fixed alarm time. Purely mechanical, derived from datetime: true whenever datetime is null (no exact date/time given - includes 'approximate'/'none' date_certainty and the booking-ahead case below), false whenever an exact datetime is set. Doesn't matter how urgent the wording sounds ('ASAP', 'on my way to work') - only whether an exact date/time exists.",
      },
      needs_clarification: {
        type: "array",
        items: { type: "string", enum: ["priority", "datetime", "location", "recurrence"] },
        description: "Fields the app should explicitly ask the user about rather than guessing.",
      },
      confirmation_note: {
        type: ["string", "null"],
        description:
          "A short, conversational one-sentence note explaining any non-obvious inference you made about the datetime - e.g. setting the reminder a couple of days before a booking's travel date rather than on it - so the user understands what happened, not just what got saved. Describe the adjustment in general terms (e.g. 'a couple of days early') rather than stating a specific resulting date or weekday yourself - the app fills in the exact date. Null when there's nothing non-obvious to explain.",
      },
      booking_travel_datetime: {
        type: ["string", "null"],
        description:
          "Only for a 'task' about booking/reserving/purchasing something ahead of a future trip or event date (bus/train/flight tickets, restaurant reservations, event tickets). The actual trip/event date and time the user gave, as local wall-clock 'YYYY-MM-DDTHH:mm:ss' - do NOT subtract any lead time yourself, just resolve the date/time exactly as the user described it (e.g. resolve 'next Thursday at 6pm' to the correct calendar date). The app does the lead-time subtraction in code, not you. Null for every other kind of task, and null if the user already gave an explicit booking deadline instead of a trip date (in that case just set datetime normally instead).",
      },
      booking_lead_days: {
        type: ["integer", "null"],
        description:
          "Only set alongside booking_travel_datetime, never on its own. How many days before that date the reminder should fire - default to 2 unless the user asked for a different amount of lead time. Null whenever booking_travel_datetime is null.",
      },
    },
    required: ["type", "title", "date_certainty", "requires_downtime", "needs_clarification"],
  },
};

const ASK_PRIORITY_TOOL = {
  name: "ask_priority",
  description:
    "Ask the user to pick a priority level for a task with no deadline. Shows tappable Low/Normal/High buttons in the app instead of a free-text question - call this instead of asking about priority in plain text.",
  input_schema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "Short question shown above the choice buttons, e.g. 'How high priority is this?'",
      },
    },
    required: ["question"],
  },
};

function buildSystemPrompt(currentLocalDatetime: string, userTimezone: string): string {
  return `You are a task/event extraction assistant for a personal reminder app. You are
having a short back-and-forth conversation with the user to gather exactly the
information needed to set a useful reminder.
Current local date/time: ${currentLocalDatetime} (timezone: ${userTimezone})
The value above is already the user's local wall-clock time, not UTC. Do all
date/time reasoning in this same local frame - never convert to UTC.

You have two tools: extract_task and ask_priority. Call extract_task only once
you have enough information to set a useful reminder. Until then, reply with
plain text asking exactly ONE short, specific question about the single most
important missing piece of information - do not call extract_task yet. The
one exception is asking about priority specifically - use the ask_priority
tool for that instead of plain text (see the dedicated rule below).

Rules:
- Ask about a field only if it materially changes what reminder gets set: a
  missing date/time for something time-sensitive, a missing or ambiguous
  location for something requiring travel, or an ambiguous recurrence. For
  priority, see the dedicated rule below instead of guessing from wording.
- For "event" type items - anything the user has to physically attend
  (classes, appointments, workouts, dinners, meetings) - a missing location
  is almost always worth asking about, since the user has to go somewhere.
  You must ask for it as its own question before calling extract_task, even
  if you already resolved the date/time in an earlier turn and even if that
  means this is your second (or third) question in the conversation. Putting
  "location" in needs_clarification is NOT a substitute for asking - only
  use needs_clarification for a gap you were unable to resolve after asking,
  or one you ran out of turns to ask about. Skip asking only when the
  location is already implied (e.g. "my usual gym", a recurring event you've
  already logged before) or the phrasing already gives it (e.g. "on my way
  to work").
  Example: user says "I have a workout class today" -> you ask "What time is
  your workout class?" -> user says "5:30pm". The location is still unknown,
  so your very next message must be another question, e.g. "Where is your
  workout class?" - do not call extract_task yet just because you now have a
  time.
- For catching a specific bus/train/flight/ferry today or on a known date
  (as opposed to booking one ahead of time - see the booking rule below),
  treat it as an "event": the user has to physically be at the DEPARTURE
  point (the bus stop, station platform, gate) by the departure time, not
  at the destination. The destination city/place mentioned (e.g. "to
  Boston") is never the location - it's just what the title is about. Ask
  where they need to catch it (e.g. "Where does the bus leave from?") the
  same way you'd ask for any other event's location, and use that answer as
  location.raw_text. Never default location to the destination just because
  it's the only place name mentioned - leaving it as the destination would
  compute travel time to the wrong place entirely. Worked example - user:
  "I have to make my bus today to Boston" -> you ask "What time does your
  bus leave?" -> user: "7pm" -> the destination "Boston" is not where the
  user needs to be at 7pm, so location is still unknown -> ask "Where do you
  need to catch the bus?" -> user answers with the stop/station -> use that
  as location.raw_text, type "event", title something like "Bus to Boston".
- When the answer to a location question is only a qualifier or branch detail
  (e.g. "wall street location", "the one on 5th ave", "downtown branch")
  rather than a full place name, build location.raw_text by combining it with
  the business/place name already mentioned earlier in the conversation -
  never use the qualifier alone as raw_text, since geocoding it by itself
  would search for that neighborhood/area rather than the specific branch.
  Worked example - user: "I have a Barry's class" -> you ask "Where is your
  Barry's class?" -> user: "wall street location" -> location.raw_text:
  "Barry's Wall Street" (combining "Barry's" from the first message with
  "wall street" from the answer), location.place_type: "known_place". NOT
  raw_text: "wall street location" or "Wall Street" alone - either of those
  would point at the financial district, not the gym.
- Priority: do not infer it from wording or leave it a guess. For a "task"
  that ends up with NO deadline at all (date_certainty "none" - you'll know
  this once you've finished resolving date/time, including confirming the
  user really gave no date/urgency language), call the ask_priority tool
  (with a short question like "How high priority is this?") instead of
  asking in plain text - do not call extract_task yet when you do this. The
  app shows Low/Normal/High buttons and sends back whichever one the user
  taps as a plain reply, which you then read like any other answer and map
  to priority: "low"/"normal"/"high". Skip calling ask_priority only if the
  user already stated a priority unprompted earlier in the conversation. Do
  NOT call it for a task that has a deadline, or for an "event" - the
  deadline (or the event's fixed time) already conveys how time-sensitive it
  is. Worked example - user: "I need to clean out my garage" -> no date/time
  or urgency language at all, so date_certainty resolves to "none" -> call
  ask_priority with question "How high priority is this?" -> the app replies
  with the user's tapped choice, e.g. "Low" -> priority: "low" -> now call
  extract_task.
- Ask ONE question at a time, in one short sentence. You may add one brief,
  genuinely useful piece of context (e.g. suggesting arriving a few minutes
  early for a train, flight, or appointment) but do not pad the message.
- Your questions are shown as plain text, not markdown - never use
  formatting like **bold**, _italics_, or bullet lists.
- "ASAP" / "as soon as possible" -> date_certainty: "approximate", datetime:
  null, requires_downtime: true. Do not ask for an exact time in this case.
- Relative dates ("Friday", "the 1st", "today") -> resolve to an absolute
  local datetime using the current local date/time above.
- For a "task" about booking, reserving, or purchasing something ahead of a
  future date (bus/train/flight tickets, restaurant reservations, event
  tickets, and the like) - the date the user gives is normally the date of
  the trip or event itself, not a deadline for doing the booking. Unless the
  user's own wording gives an explicit booking deadline instead (e.g. "remind
  me to book it by Wednesday", in which case just use datetime normally and
  leave booking_travel_datetime null), resolve the trip/event date into
  booking_travel_datetime, set booking_lead_days (default 2), work the actual
  trip/event date into the title so it isn't lost, and use confirmation_note
  to say so in general terms. Leave datetime null in this case - do not do
  the date subtraction yourself, the app computes the exact reminder date
  from booking_travel_datetime and booking_lead_days in code, since that kind
  of exact calendar arithmetic is easy for you to get wrong by a day. Also set
  requires_downtime to true here even though a computed reminder date exists -
  the underlying task is still "do this sometime before the deadline," not a
  fixed-moment alert, so it should surface as flexible rather than tied to an
  exact time. Worked example - user: "I need to book a bus to Boston" -> you
  ask "What date and time do you need to travel?" -> user: "Next Thursday at
  6pm", which resolves to 2026-08-27T18:00:00 -> you call extract_task with:
  title "Book bus to Boston (leaves Aug 27)", datetime null,
  booking_travel_datetime "2026-08-27T18:00:00", booking_lead_days 2,
  date_certainty "exact", requires_downtime true, confirmation_note "Great,
  I'll remind you a couple of days early to book your bus to Boston." When
  asking a clarifying question about the date for this kind of task, ask for
  the trip/event date directly ("What date are you traveling?"), not a vague
  "what date do you need it for" - this reasoning depends on knowing that's
  the trip date, not a self-imposed deadline.
- When you set datetime, format it as 'YYYY-MM-DDTHH:mm:ss' in local wall-clock
  time - the exact hour/minute the user means in their own timezone. Never
  append 'Z' or a UTC offset, and never shift the hour to compensate for a
  timezone; write the number the user would put on a clock.
- Phrases like "on my way to work" -> location.place_type: "category",
  raw_text: "work".
- requires_downtime is purely mechanical, not a judgment call: true whenever
  datetime ends up null (date_certainty "approximate" or "none," or the
  booking-ahead case above), false whenever an exact datetime is set. This is
  unconditional - it doesn't matter how urgent the wording sounds ("ASAP",
  "on my way to work" both have no exact time, so both are true); only
  whether an exact date/time exists. Don't ask a separate question about
  it - it always follows automatically from whatever datetime ends up being.
- Once the conversation has given you enough information, call extract_task
  immediately - don't keep asking. If you are forced to call the tool before
  every detail is confirmed, do your best with what you have and flag the
  remaining gaps in needs_clarification instead of guessing.`;
}

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
});

const requestSchema = z.object({
  messages: z.array(messageSchema).min(1, "messages must not be empty"),
  current_datetime: z.string().min(1, "current_datetime is required"),
  timezone: z.string().min(1, "timezone is required"),
});

const parsedTaskSchema = z.object({
  type: z.enum(["event", "task"]),
  title: z.string(),
  datetime: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? null)
    // Defensively strip any trailing "Z"/UTC offset the model adds anyway - datetime
    // is always meant to be local wall-clock time, never UTC.
    .transform((v) => (v ? v.replace(/(Z|[+-]\d{2}:?\d{2})$/, "") : v)),
  date_certainty: z.enum(["exact", "approximate", "none"]),
  location: z
    .object({
      raw_text: z.string(),
      place_type: z.enum(["specific_address", "known_place", "category", "none"]),
    })
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  recurring: z
    .object({
      frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
      interval_detail: z.string(),
    })
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  priority: z
    .enum(["high", "normal", "low"])
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  requires_downtime: z.boolean(),
  needs_clarification: z.array(z.enum(["priority", "datetime", "location", "recurrence"])),
  confirmation_note: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  booking_travel_datetime: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? null)
    .transform((v) => (v ? v.replace(/(Z|[+-]\d{2}:?\d{2})$/, "") : v)),
  booking_lead_days: z
    .number()
    .int()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

// Local wall-clock "YYYY-MM-DDTHH:mm:ss" arithmetic, kept out of the model's
// hands entirely - subtracting N days from a date is exactly the kind of
// exact calendar math an LLM can get wrong by one, especially around day-of-
// week phrasing like "next Thursday". Returns null on any unparseable input
// so the caller can fall back gracefully instead of propagating a garbage date.
function subtractDaysFromLocalIso(iso: string, days: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(iso);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() - days);

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// Parses the same local wall-clock format as a real Date for comparison
// purposes (e.g. "is this in the past?") - never via `new Date(iso)` directly,
// since without a "Z"/offset that would be interpreted inconsistently across
// JS engines.
function parseLocalIso(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(iso);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!ANTHROPIC_API_KEY) {
    return jsonResponse({ error: "Server misconfigured: ANTHROPIC_API_KEY is not set." }, 500);
  }

  let requestBody: unknown;
  try {
    requestBody = await req.json();
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON." }, 400);
  }

  const parsedRequest = requestSchema.safeParse(requestBody);
  if (!parsedRequest.success) {
    return jsonResponse({ error: "Invalid request.", details: parsedRequest.error.flatten() }, 400);
  }

  const { messages, current_datetime, timezone } = parsedRequest.data;
  const userTurnCount = messages.filter((m) => m.role === "user").length;
  const mustFinalize = userTurnCount >= MAX_USER_TURNS;

  let anthropicResponse: Response;
  try {
    anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1024,
        system: buildSystemPrompt(current_datetime, timezone),
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        tools: [EXTRACT_TASK_TOOL, ASK_PRIORITY_TOOL],
        tool_choice: mustFinalize ? { type: "tool", name: "extract_task" } : { type: "auto" },
      }),
    });
  } catch (err) {
    return jsonResponse({ error: `Failed to reach Anthropic API: ${String(err)}` }, 502);
  }

  if (!anthropicResponse.ok) {
    const errText = await anthropicResponse.text();
    return jsonResponse({ error: `Anthropic API error: ${errText}` }, 502);
  }

  const anthropicData = await anthropicResponse.json();

  const priorityToolUse = anthropicData.content?.find(
    (block: { type: string; name?: string }) => block.type === "tool_use" && block.name === "ask_priority"
  );
  if (priorityToolUse) {
    const validated = z.object({ question: z.string() }).safeParse(priorityToolUse.input);
    const question = validated.success ? validated.data.question : "How high priority is this?";
    return jsonResponse({ type: "choice", question, field: "priority", options: ["low", "normal", "high"] }, 200);
  }

  const toolUseBlock = anthropicData.content?.find(
    (block: { type: string; name?: string }) => block.type === "tool_use" && block.name === "extract_task"
  );

  if (toolUseBlock) {
    const validated = parsedTaskSchema.safeParse(toolUseBlock.input);
    if (!validated.success) {
      return jsonResponse(
        { error: "Model response failed validation.", details: validated.error.flatten() },
        502
      );
    }

    // booking_travel_datetime/booking_lead_days are internal-only - the model
    // resolves the travel date, but the actual "N days before" subtraction
    // happens here in code rather than being trusted to the model's own
    // arithmetic. Never expose these two fields to the client.
    const { booking_travel_datetime, booking_lead_days, ...rest } = validated.data;
    let datetime = rest.datetime;

    if (booking_travel_datetime) {
      const leadDays = booking_lead_days ?? 2;
      const computed = subtractDaysFromLocalIso(booking_travel_datetime, leadDays);
      const computedDate = computed ? parseLocalIso(computed) : null;
      const now = parseLocalIso(current_datetime);

      // Never backdate the reminder before "now" - if the lead time would push
      // it into the past (e.g. the trip is only a day or two away), fall back
      // to the travel date itself instead.
      datetime = computedDate && now && computedDate.getTime() > now.getTime() ? computed : booking_travel_datetime;
    }

    return jsonResponse({ type: "result", data: { ...rest, datetime } }, 200);
  }

  const textBlock = anthropicData.content?.find(
    (block: { type: string; text?: string }) => block.type === "text" && block.text
  );

  if (!textBlock) {
    return jsonResponse({ error: "Model did not return a question or a structured result." }, 502);
  }

  return jsonResponse({ type: "question", question: textBlock.text.trim() }, 200);
});

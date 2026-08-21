import { z } from "https://esm.sh/zod@3.23.8";
import { corsHeaders } from "../_shared/cors.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_USER_TURNS = 3;

const UPDATE_TASK_TOOL = {
  name: "update_task",
  description:
    "Apply the requested change(s) to the task. Only include fields the user's instruction asked to change - omit everything else.",
  input_schema: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["event", "task"] },
      title: { type: "string" },
      datetime: {
        type: ["string", "null"],
        description:
          "Local wall-clock datetime as 'YYYY-MM-DDTHH:mm:ss' (no timezone offset, no trailing 'Z'). Null to clear it.",
      },
      date_certainty: { type: "string", enum: ["exact", "approximate", "none"] },
      location: {
        type: ["object", "null"],
        properties: {
          raw_text: { type: "string" },
          place_type: {
            type: "string",
            enum: ["specific_address", "known_place", "category", "none"],
          },
        },
        description: "Null to clear the location.",
      },
      recurring: {
        type: ["object", "null"],
        properties: {
          frequency: { type: "string", enum: ["daily", "weekly", "monthly", "yearly"] },
          interval_detail: { type: "string" },
        },
        description: "Null to clear recurrence.",
      },
      priority: { type: ["string", "null"], enum: ["high", "normal", "low", null] },
      requires_downtime: { type: "boolean" },
    },
    required: [],
  },
};

const UPDATE_TITLE_TOOL = {
  name: "update_title",
  description: "Set a new title for the task.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
    },
    required: ["title"],
  },
};

function buildTitleSyncSystemPrompt(currentTaskJson: string): string {
  return `You help keep a task's title in sync with its other fields for a personal
reminder app. The user just changed one field of the task using a manual
field editor (described in the message below) - they did not type a
request, so don't treat the description as an instruction to act on beyond
deciding whether the title needs updating.

Current task (JSON, already reflects the change that was just made):
${currentTaskJson}

You have one tool, update_title. Call it ONLY if the current title is now
stale because of the change described - for example, the title names a
location, day, or detail that no longer matches the task's current fields.
Change only the stale part of the title; keep the rest of its wording as-is.
Do not invent new information that wasn't already implied by the title.

If the title still makes sense as-is, don't call the tool - just reply with
a short sentence saying so (this reply is not shown to the user).`;
}

function buildSystemPrompt(currentTaskJson: string, currentLocalDatetime: string, userTimezone: string): string {
  return `You are a task-editing assistant for a personal reminder app. The user is
looking at an existing task and describing a change they want made to it in
plain language.

Current task (JSON):
${currentTaskJson}

Current local date/time: ${currentLocalDatetime} (timezone: ${userTimezone})
This is the user's local wall-clock time, not UTC. Do all date/time reasoning
in this same local frame - never convert to UTC.

You have one tool, update_task. Call it only once you have enough information
to make the requested change unambiguously. Until then, reply with plain text
asking exactly ONE short, specific question about the missing detail - do not
call the tool yet.

Rules:
- Only include fields in update_task that the user's instruction asked to
  change. Never include a field just because it appears in the current task
  JSON above - that JSON is context for resolving relative changes (like "an
  hour later" or "double the notice"), not a template to echo back.
- To clear the location or recurrence, set that field to null. To clear
  priority, set it to null. Never set title, type, date_certainty, or
  requires_downtime to null.
- If the instruction changes the location and the task's current title
  names the old location by name (e.g. title "Dinner at Crown Shy", old
  location "Crown Shy"), also include an updated title that swaps in the new
  location name - change only that reference, keep the rest of the title's
  wording as-is. If the title doesn't mention the old location by name,
  leave the title out of the tool call entirely.
- When you set datetime, format it as 'YYYY-MM-DDTHH:mm:ss' in local
  wall-clock time - the exact hour/minute the user means. Never append 'Z' or
  a UTC offset, and never shift the hour to compensate for a timezone.
- Relative dates/times ("tomorrow", "next Tuesday", "an hour later") resolve
  against the current local date/time above and, when relevant, the task's
  current datetime.
- If the instruction is ambiguous or missing information you need (e.g.
  "move it later" with no amount given), ask ONE short clarifying question
  instead of guessing.
- Your questions are shown as plain text, not markdown - never use
  formatting like **bold**, _italics_, or bullet lists.
- Once you have enough information, call update_task immediately - don't
  keep asking. If forced to call the tool before every detail is confirmed,
  do your best with what's given.`;
}

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
});

const taskContextSchema = z.object({
  type: z.enum(["event", "task"]),
  title: z.string(),
  datetime: z.string().nullable(),
  date_certainty: z.enum(["exact", "approximate", "none"]),
  location: z
    .object({
      raw_text: z.string(),
      place_type: z.enum(["specific_address", "known_place", "category", "none"]),
    })
    .nullable(),
  recurring: z
    .object({
      frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
      interval_detail: z.string(),
    })
    .nullable(),
  priority: z.enum(["high", "normal", "low"]).nullable(),
  requires_downtime: z.boolean(),
});

const requestSchema = z.object({
  task: taskContextSchema,
  messages: z.array(messageSchema).min(1, "messages must not be empty"),
  current_datetime: z.string().min(1, "current_datetime is required"),
  timezone: z.string().min(1, "timezone is required"),
  // Set when this call is a silent background check (after a manual field edit) rather
  // than an interactive request from the Ask AI box - constrains the response to a
  // title-only update with no clarifying questions.
  title_sync_only: z.boolean().optional().default(false),
});

// Strips any trailing "Z"/UTC offset without touching undefined/null - unlike
// parse-task's version, a missing key here means "don't change this field," which
// is not the same as null ("clear this field"), so the two must stay distinguishable.
const stripTzSuffix = (v: string | null | undefined) =>
  v ? v.replace(/(Z|[+-]\d{2}:?\d{2})$/, "") : v;

const updateTaskSchema = z.object({
  type: z.enum(["event", "task"]).optional(),
  title: z.string().optional(),
  datetime: z.string().nullable().optional().transform(stripTzSuffix),
  date_certainty: z.enum(["exact", "approximate", "none"]).optional(),
  location: z
    .object({
      raw_text: z.string(),
      place_type: z.enum(["specific_address", "known_place", "category", "none"]),
    })
    .nullable()
    .optional(),
  recurring: z
    .object({
      frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
      interval_detail: z.string(),
    })
    .nullable()
    .optional(),
  priority: z.enum(["high", "normal", "low"]).nullable().optional(),
  requires_downtime: z.boolean().optional(),
});

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

  const { task, messages, current_datetime, timezone, title_sync_only } = parsedRequest.data;
  const userTurnCount = messages.filter((m) => m.role === "user").length;
  const mustFinalize = userTurnCount >= MAX_USER_TURNS;

  const tool = title_sync_only ? UPDATE_TITLE_TOOL : UPDATE_TASK_TOOL;
  const system = title_sync_only
    ? buildTitleSyncSystemPrompt(JSON.stringify(task, null, 2))
    : buildSystemPrompt(JSON.stringify(task, null, 2), current_datetime, timezone);

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
        system,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        tools: [tool],
        tool_choice: !title_sync_only && mustFinalize ? { type: "tool", name: "update_task" } : { type: "auto" },
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

  if (title_sync_only) {
    const toolUseBlock = anthropicData.content?.find(
      (block: { type: string; name?: string }) => block.type === "tool_use" && block.name === "update_title"
    );
    if (!toolUseBlock) {
      // Model decided the title doesn't need to change - a no-op result, not an error.
      return jsonResponse({ type: "result", data: {} }, 200);
    }
    const validated = z.object({ title: z.string() }).safeParse(toolUseBlock.input);
    if (!validated.success) {
      return jsonResponse({ type: "result", data: {} }, 200);
    }
    return jsonResponse({ type: "result", data: { title: validated.data.title } }, 200);
  }

  const toolUseBlock = anthropicData.content?.find(
    (block: { type: string; name?: string }) => block.type === "tool_use" && block.name === "update_task"
  );

  if (toolUseBlock) {
    const validated = updateTaskSchema.safeParse(toolUseBlock.input);
    if (!validated.success) {
      return jsonResponse(
        { error: "Model response failed validation.", details: validated.error.flatten() },
        502
      );
    }
    return jsonResponse({ type: "result", data: validated.data }, 200);
  }

  const textBlock = anthropicData.content?.find(
    (block: { type: string; text?: string }) => block.type === "text" && block.text
  );

  if (!textBlock) {
    return jsonResponse({ error: "Model did not return a question or a structured result." }, 502);
  }

  return jsonResponse({ type: "question", question: textBlock.text.trim() }, 200);
});

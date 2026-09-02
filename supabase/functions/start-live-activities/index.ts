import { createClient } from "https://esm.sh/@supabase/supabase-js@2.111.0";
import { SignJWT, importPKCS8 } from "https://esm.sh/jose@5.9.6";
import { corsHeaders } from "../_shared/cors.ts";

// Unlike every other function in this project, this one is never called by
// the client - it's hit once a minute by a pg_cron job (see the
// 20260827130200_schedule_start_live_activities.sql migration) and is the
// first edge function here to talk to the database directly, since its job
// is inherently server-driven: watch tasks.leaving_by crossing the
// 15-minutes-out mark and push-to-start a Live Activity even if the app
// isn't open.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID");
const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID");
const APNS_PRIVATE_KEY = Deno.env.get("APNS_PRIVATE_KEY"); // PEM contents of the .p8 auth key
const APNS_BUNDLE_ID = Deno.env.get("APNS_BUNDLE_ID");
// "sandbox" for a development-signed dev-client build, "production" once
// shipped via TestFlight/App Store - see the plan's Risks section.
const APNS_ENVIRONMENT = Deno.env.get("APNS_ENVIRONMENT") ?? "sandbox";

// TEMP DEBUG - widened from 14/15 for manual testing convenience (a 1-minute
// window is hard to hit exactly during manual invoke round-trips). Revert to
// 14/15 once device testing confirms the push itself works.
const RECHECK_WINDOW_START_MINUTES = 5;
const RECHECK_WINDOW_END_MINUTES = 25;

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface EligibleTask {
  id: string;
  user_id: string;
  title: string;
  location_raw_text: string | null;
  datetime: string;
  leaving_by: string;
}

// Builds a short-lived ES256 APNs auth JWT per Apple's spec. Recomputed once
// per invocation rather than cached across calls - this function only runs
// once a minute, so the extra signing cost is negligible, and caching would
// need its own staleness handling that isn't worth it until this is
// confirmed working end-to-end.
async function buildApnsJwt(): Promise<string> {
  const key = await importPKCS8(APNS_PRIVATE_KEY!, "ES256");
  return new SignJWT({ iss: APNS_TEAM_ID })
    .setProtectedHeader({ alg: "ES256", kid: APNS_KEY_ID })
    .setIssuedAt()
    .sign(key);
}

// expo-widgets uses ONE generic native ActivityAttributes type
// ("LiveActivityAttributes", defined in its own ios/Widgets/WidgetLiveActivity.swift)
// for every live activity a project defines, rather than generating a
// per-widget Swift struct. Its ContentState is fixed: { name: string, props:
// string } - "name" is the widget's registered name (matches what's passed
// to createLiveActivity(...) and the app.json widget entry), and "props" is
// our actual DepartureActivityProps (src/lib/liveActivity.tsx), JSON-encoded
// as a STRING, not nested as an object. "attributes-type" must be the Swift
// type name "LiveActivityAttributes" itself, not the widget's name - Apple's
// push-to-start payload names the ActivityAttributes struct there.
async function sendPushToStart(token: string, jwt: string, task: EligibleTask): Promise<Response> {
  const host =
    APNS_ENVIRONMENT === "production" ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";

  const props = JSON.stringify({
    taskTitle: task.title,
    locationLabel: task.location_raw_text,
    eventTimeIso: task.datetime,
    leavingByIso: task.leaving_by,
  });

  const body = {
    aps: {
      timestamp: Math.floor(Date.now() / 1000),
      event: "start",
      "content-state": { name: "DepartureActivity", props },
      "attributes-type": "LiveActivityAttributes",
      attributes: {},
      alert: { title: "Time to leave soon", body: `Leaving for ${task.title} shortly` },
    },
  };

  return fetch(`${host}/3/device/${token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-push-type": "liveactivity",
      "apns-topic": `${APNS_BUNDLE_ID}.push-type.liveactivity`,
      "apns-priority": "10",
    },
    body: JSON.stringify(body),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  for (const [name, value] of Object.entries({
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    APNS_KEY_ID,
    APNS_TEAM_ID,
    APNS_PRIVATE_KEY,
    APNS_BUNDLE_ID,
  })) {
    if (!value) return jsonResponse({ error: `Server misconfigured: ${name} is not set.` }, 500);
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  const now = Date.now();
  const windowStart = new Date(now + RECHECK_WINDOW_START_MINUTES * 60_000).toISOString();
  const windowEnd = new Date(now + RECHECK_WINDOW_END_MINUTES * 60_000).toISOString();

  const { data: tasks, error: tasksError } = await supabase
    .from("tasks")
    .select("id, user_id, title, location_raw_text, datetime, leaving_by")
    .gte("leaving_by", windowStart)
    .lt("leaving_by", windowEnd)
    .eq("is_completed", false)
    .is("live_activity_started_at", null);

  if (tasksError) return jsonResponse({ error: `DB query failed: ${tasksError.message}` }, 500);
  if (!tasks || tasks.length === 0) {
    // TEMP DEBUG - remove once the matching bug is found.
    const { data: allUpcoming } = await supabase
      .from("tasks")
      .select("id, leaving_by, is_completed, live_activity_started_at")
      .not("leaving_by", "is", null)
      .eq("is_completed", false)
      .order("leaving_by", { ascending: true })
      .limit(10);
    return jsonResponse({ started: 0, debug: { windowStart, windowEnd, allUpcoming } }, 200);
  }

  const userIds = [...new Set(tasks.map((t) => t.user_id))];
  const { data: tokenRows, error: tokenError } = await supabase
    .from("device_push_tokens")
    .select("user_id, push_to_start_token")
    .in("user_id", userIds);

  if (tokenError) return jsonResponse({ error: `Token query failed: ${tokenError.message}` }, 500);

  const tokenByUser = new Map((tokenRows ?? []).map((r) => [r.user_id, r.push_to_start_token as string]));
  const jwt = await buildApnsJwt();

  let started = 0;
  // TEMP DEBUG - collecting failures into the response so they're visible
  // without a working `supabase functions logs` command on this CLI version.
  const failures: unknown[] = [];
  for (const task of tasks as EligibleTask[]) {
    const token = tokenByUser.get(task.user_id);
    if (!token) continue; // No registered device for this user - nothing to push to.

    try {
      const res = await sendPushToStart(token, jwt, task);
      if (!res.ok) {
        const body = await res.text();
        console.error(`APNs push-to-start failed for task ${task.id}: ${res.status} ${body}`);
        failures.push({ taskId: task.id, status: res.status, body });
        continue;
      }
      // Marked per-task, right after its own successful push - so a
      // mid-loop APNs failure doesn't lose progress on tasks that already
      // succeeded, and a failed one just stays eligible for next minute's tick.
      await supabase.from("tasks").update({ live_activity_started_at: new Date().toISOString() }).eq("id", task.id);
      started++;
    } catch (err) {
      console.error(`APNs request failed for task ${task.id}: ${String(err)}`);
      failures.push({ taskId: task.id, error: String(err) });
    }
  }

  if (failures.length > 0) return jsonResponse({ started, failures }, 200);

  return jsonResponse({ started }, 200);
});

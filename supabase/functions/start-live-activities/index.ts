import { createClient } from "https://esm.sh/@supabase/supabase-js@2.111.0";
import { SignJWT, importPKCS8 } from "https://esm.sh/jose@5.9.6";
import { corsHeaders } from "../_shared/cors.ts";
import { liveActivityWindow } from "../_shared/liveActivityWindow.ts";
import {
  isDeadToken,
  pushTargetsByUser,
  type ApnsEnvironment,
  type LegacyTokenRow,
  type PushTarget,
  type TokenRow,
} from "../_shared/pushTargets.ts";

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
// The app and APNs environment for tokens from the older device_push_tokens
// table, which doesn't record which app they came from. Tokens in
// live_activity_tokens carry their own.
const APNS_BUNDLE_ID = Deno.env.get("APNS_BUNDLE_ID");
const APNS_ENVIRONMENT: ApnsEnvironment = Deno.env.get("APNS_ENVIRONMENT") === "production" ? "production" : "sandbox";


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
async function sendPushToStart(target: PushTarget, jwt: string, task: EligibleTask): Promise<Response> {
  const host =
    target.environment === "production" ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";

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

  return fetch(`${host}/3/device/${target.token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-push-type": "liveactivity",
      "apns-topic": `${target.bundleId}.push-type.liveactivity`,
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
  const { from: windowStart, to: windowEnd } = liveActivityWindow(now);

  const { data: tasks, error: tasksError } = await supabase
    .from("tasks")
    .select("id, user_id, title, location_raw_text, datetime, leaving_by")
    .gte("leaving_by", windowStart)
    .lte("leaving_by", windowEnd)
    .eq("is_completed", false)
    .is("live_activity_started_at", null);

  if (tasksError) return jsonResponse({ error: `DB query failed: ${tasksError.message}` }, 500);
  if (!tasks || tasks.length === 0) return jsonResponse({ started: 0 }, 200);

  const userIds = [...new Set(tasks.map((t) => t.user_id))];
  const [perApp, legacy] = await Promise.all([
    supabase
      .from("live_activity_tokens")
      .select("id, user_id, push_to_start_token, bundle_id, apns_environment, updated_at")
      .in("user_id", userIds),
    supabase.from("device_push_tokens").select("id, user_id, push_to_start_token").in("user_id", userIds),
  ]);
  if (perApp.error) return jsonResponse({ error: `Token query failed: ${perApp.error.message}` }, 500);
  if (legacy.error) return jsonResponse({ error: `Token query failed: ${legacy.error.message}` }, 500);

  const targetsByUser = pushTargetsByUser(
    (perApp.data ?? []) as TokenRow[],
    (legacy.data ?? []) as LegacyTokenRow[],
    { bundleId: APNS_BUNDLE_ID!, environment: APNS_ENVIRONMENT }
  );
  const jwt = await buildApnsJwt();
  // Tokens found dead this run, so a second task for the same user doesn't
  // try them again.
  const deadTokens = new Set<string>();

  let started = 0;
  // Collected (not just console.error'd) so failures are visible in the
  // cron job's own response even without a working `supabase functions
  // logs` command on this CLI version.
  const failures: unknown[] = [];
  for (const task of tasks as EligibleTask[]) {
    const targets = (targetsByUser.get(task.user_id) ?? []).filter((t) => !deadTokens.has(t.token));
    // One Live Activity per task: the most recently opened app first, moving
    // on to the next only if APNs says that app's token is dead.
    for (const target of targets) {
      try {
        const res = await sendPushToStart(target, jwt, task);
        if (res.ok) {
          // Marked per-task, right after its own successful push - so a
          // mid-loop failure doesn't lose progress on tasks that already
          // succeeded, and a failed one stays eligible for next minute's tick.
          await supabase
            .from("tasks")
            .update({ live_activity_started_at: new Date().toISOString() })
            .eq("id", task.id);
          started++;
          break;
        }
        const body = await res.text();
        console.error(`APNs push-to-start failed for task ${task.id} (${target.bundleId}): ${res.status} ${body}`);
        failures.push({ taskId: task.id, bundleId: target.bundleId, status: res.status, body });
        if (!isDeadToken(res.status, body)) break; // Might work next minute - keep the token.
        deadTokens.add(target.token);
        await supabase.from(target.table).delete().eq("id", target.id);
      } catch (err) {
        console.error(`APNs request failed for task ${task.id}: ${String(err)}`);
        failures.push({ taskId: task.id, error: String(err) });
        break;
      }
    }
  }

  if (failures.length > 0) return jsonResponse({ started, failures }, 200);

  return jsonResponse({ started }, 200);
});

import { z } from "https://esm.sh/zod@3.23.8";
import { corsHeaders } from "../_shared/cors.ts";

const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");

const coordsSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

const requestSchema = z.object({
  origin: coordsSchema,
  destination: coordsSchema,
  // When the user needs to arrive by, in ISO 8601. Only honored for transit -
  // the Directions API has no "arrive by" concept for walking/driving.
  arrival_time: z.string().min(1, "arrival_time is required"),
  mode: z.enum(["transit", "walking", "driving"]).optional().default("transit"),
});

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toCoordParam(c: { latitude: number; longitude: number }): string {
  return `${c.latitude},${c.longitude}`;
}

interface DirectionsResult {
  seconds: number;
  summary: string | null;
}

// Builds a short one-line "how to get there" description from the same
// Directions API response already fetched for the duration - no extra API
// call needed, the step-level data is just sitting unused in the response.
// Transit routes name the line(s) to take (e.g. "Take the A then the L");
// walking/driving routes just state how long, since turn-by-turn street
// names aren't useful at a glance in a reminder card.
function summarizeLeg(leg: any, mode: "transit" | "walking" | "driving"): string | null {
  if (mode === "transit") {
    const transitSteps: any[] = (leg.steps ?? []).filter(
      (s: any) => s.travel_mode === "TRANSIT" && s.transit_details?.line
    );
    if (transitSteps.length > 0) {
      const names = transitSteps.map((s: any) => {
        const line = s.transit_details.line;
        return line.short_name || line.name || "transit";
      });
      const unique = [...new Set(names)];
      return `Take the ${unique.join(" then the ")}`;
    }
    // Transit requested but the route came back all-walking (no nearby
    // service) - fall through to the walking phrasing below.
  }

  const durationText = leg.duration?.text;
  if (!durationText) return null;
  return mode === "driving" ? `${durationText} drive` : `${durationText} walk`;
}

async function fetchDirections(
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
  mode: "transit" | "walking" | "driving",
  arrivalUnixSeconds: number | null
): Promise<DirectionsResult | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
  url.searchParams.set("origin", toCoordParam(origin));
  url.searchParams.set("destination", toCoordParam(destination));
  url.searchParams.set("mode", mode);
  url.searchParams.set("key", GOOGLE_MAPS_API_KEY!);

  // The Directions API only supports targeting an arrival time for transit.
  if (mode === "transit" && arrivalUnixSeconds !== null) {
    url.searchParams.set("arrival_time", String(arrivalUnixSeconds));
  } else if (mode === "driving") {
    url.searchParams.set("departure_time", "now");
  }

  const response = await fetch(url);
  if (!response.ok) return null;

  const data = await response.json();
  if (data.status !== "OK" || !data.routes?.[0]?.legs?.[0]) return null;

  const leg = data.routes[0].legs[0];
  const seconds = leg.duration_in_traffic?.value ?? leg.duration?.value;
  if (typeof seconds !== "number") return null;

  return { seconds, summary: summarizeLeg(leg, mode) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!GOOGLE_MAPS_API_KEY) {
    return jsonResponse({ error: "Server misconfigured: GOOGLE_MAPS_API_KEY is not set." }, 500);
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

  const { origin, destination, arrival_time, mode } = parsedRequest.data;
  const arrivalDate = new Date(arrival_time);
  const arrivalUnixSeconds = Number.isNaN(arrivalDate.getTime())
    ? null
    : Math.floor(arrivalDate.getTime() / 1000);

  let result: DirectionsResult | null;
  try {
    result = await fetchDirections(origin, destination, mode, arrivalUnixSeconds);
    // Transit directions are commonly unavailable (no nearby service, no data for
    // the route) - fall back to walking rather than failing the whole request.
    if (result === null && mode === "transit") {
      result = await fetchDirections(origin, destination, "walking", null);
    }
  } catch (err) {
    return jsonResponse({ error: `Failed to reach Google Directions API: ${String(err)}` }, 502);
  }

  if (result === null) {
    return jsonResponse({ found: false }, 200);
  }

  return jsonResponse(
    { found: true, duration_minutes: Math.round(result.seconds / 60), directions_summary: result.summary },
    200
  );
});

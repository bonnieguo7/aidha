import { z } from "https://esm.sh/zod@3.23.8";
import { corsHeaders } from "../_shared/cors.ts";

// Google Maps Platform key with the Geocoding API enabled. Never exposed to the
// client - this function is the only thing that ever sees it.
const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");

const requestSchema = z.object({
  query: z.string().min(1, "query is required"),
  bias: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
});

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface Coords {
  latitude: number;
  longitude: number;
}

interface GeocodeResult extends Coords {
  formattedAddress: string | null;
}

// Resolves chain/business names (e.g. "Equinox") and named-branch queries (e.g.
// "Barry's Wall Street") via Places API (New) Text Search - the plain Geocoding
// API has no concept of business names at all, only addresses. `bias` is
// optional: passing the user's current location lets a genuinely bare, ambiguous
// name ("Equinox" with no qualifier) resolve to the nearest branch instead of
// whichever one Google considers "canonical"; omitting it runs a plain text
// search, which is what a query that already names a specific branch/area needs -
// a proximity bias toward wherever the user happens to be right now can otherwise
// outrank the one actually named in the text.
// Returns null (rather than throwing) on any failure so the caller can fall back
// to another strategy instead of failing the whole request.
async function geocodeViaPlaces(query: string, bias?: Coords): Promise<GeocodeResult | null> {
  try {
    const body: Record<string, unknown> = { textQuery: query };
    if (bias) {
      body.locationBias = {
        circle: { center: { latitude: bias.latitude, longitude: bias.longitude }, radius: 50000 },
      };
    }

    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY!,
        "X-Goog-FieldMask": "places.location,places.formattedAddress,places.displayName",
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("Places (New) searchText HTTP error", { query, biased: Boolean(bias), status: res.status, data });
      return null;
    }
    const place = data.places?.[0];
    const location = place?.location;
    if (typeof location?.latitude !== "number" || typeof location?.longitude !== "number") {
      console.error("Places (New) searchText no usable location", { query, biased: Boolean(bias), data });
      return null;
    }
    console.log("Places (New) searchText resolved", {
      query,
      biased: Boolean(bias),
      matchedName: place.displayName?.text,
      matchedAddress: place.formattedAddress,
    });
    return {
      latitude: location.latitude,
      longitude: location.longitude,
      formattedAddress: typeof place.formattedAddress === "string" ? place.formattedAddress : null,
    };
  } catch (err) {
    console.error("Places (New) searchText threw", { query, biased: Boolean(bias), err: String(err) });
    return null;
  }
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

  if (parsedRequest.data.bias) {
    const biasedResult = await geocodeViaPlaces(parsedRequest.data.query, parsedRequest.data.bias);
    if (biasedResult) {
      return jsonResponse(
        {
          found: true,
          latitude: biasedResult.latitude,
          longitude: biasedResult.longitude,
          formattedAddress: biasedResult.formattedAddress,
        },
        200
      );
    }
  }

  // Retry as a plain (unbiased) Places text search - covers both the case where
  // there was no bias to try in the first place, and the case where the biased
  // attempt came back empty because the named place isn't near the user's
  // current location (e.g. a specific branch across town, or in another city).
  const unbiasedResult = await geocodeViaPlaces(parsedRequest.data.query);
  if (unbiasedResult) {
    return jsonResponse(
      {
        found: true,
        latitude: unbiasedResult.latitude,
        longitude: unbiasedResult.longitude,
        formattedAddress: unbiasedResult.formattedAddress,
      },
      200
    );
  }

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", parsedRequest.data.query);
  url.searchParams.set("key", GOOGLE_MAPS_API_KEY);

  let googleResponse: Response;
  try {
    googleResponse = await fetch(url);
  } catch (err) {
    return jsonResponse({ error: `Failed to reach Google Geocoding API: ${String(err)}` }, 502);
  }

  if (!googleResponse.ok) {
    const errText = await googleResponse.text();
    return jsonResponse({ error: `Google Geocoding API error: ${errText}` }, 502);
  }

  const data = await googleResponse.json();

  if (data.status !== "OK" || !data.results?.[0]) {
    // Not found is a normal, expected outcome (e.g. a vague or made-up location) -
    // not a server error, so the caller can show a clear "couldn't find that place"
    // state rather than a generic failure.
    return jsonResponse({ found: false }, 200);
  }

  const location = data.results[0].geometry?.location;
  if (typeof location?.lat !== "number" || typeof location?.lng !== "number") {
    return jsonResponse({ found: false }, 200);
  }

  const formattedAddress =
    typeof data.results[0].formatted_address === "string" ? data.results[0].formatted_address : null;

  return jsonResponse(
    { found: true, latitude: location.lat, longitude: location.lng, formattedAddress },
    200
  );
});

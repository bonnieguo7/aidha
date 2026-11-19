// A short, safe-to-return description of why a Google Maps request failed,
// e.g. "Places (New) HTTP 403 PERMISSION_DENIED: API key not authorized...".
// Returned to the caller only when a lookup fails, so a refused request
// explains itself instead of looking like "place not found". Anything shaped
// like a Google API key is scrubbed and the text is capped, so it can never
// echo a secret back.
export function describeGoogleError(source: string, parts: { status?: unknown; message?: unknown }): string {
  const clean = (value: unknown) =>
    typeof value === "string" ? value.replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]").slice(0, 240) : "";
  const status = clean(parts.status);
  const message = clean(parts.message);
  return [source, status, message].filter(Boolean).join(": ");
}

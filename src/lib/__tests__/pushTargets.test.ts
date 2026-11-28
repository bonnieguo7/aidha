import { isDeadToken, pushTargetsByUser } from "../../../supabase/functions/_shared/pushTargets";

const fallback = { bundleId: "com.example.app", environment: "production" as const };
const row = (id: string, user_id: string, token: string, bundle_id: string, updated_at: string, env: "sandbox" | "production" = "production") => ({
  id,
  user_id,
  push_to_start_token: token,
  bundle_id,
  apns_environment: env,
  updated_at,
});

describe("pushTargetsByUser", () => {
  it("tries the app opened most recently first, each with its own topic and environment", () => {
    const targets = pushTargetsByUser(
      [
        row("1", "u1", "tok-prod", "com.example.app", "2026-11-20T10:00:00Z"),
        row("2", "u1", "tok-dev", "com.example.app.dev", "2026-11-26T10:00:00Z", "sandbox"),
      ],
      [],
      fallback
    ).get("u1")!;
    expect(targets.map((t) => [t.token, t.bundleId, t.environment])).toEqual([
      ["tok-dev", "com.example.app.dev", "sandbox"],
      ["tok-prod", "com.example.app", "production"],
    ]);
  });

  it("falls back to the legacy token with the configured app, after the per-app ones", () => {
    const targets = pushTargetsByUser(
      [row("1", "u1", "tok-new", "com.example.app.dev", "2026-11-26T10:00:00Z", "sandbox")],
      [{ id: "L", user_id: "u1", push_to_start_token: "tok-old" }],
      fallback
    ).get("u1")!;
    expect(targets.map((t) => [t.table, t.token, t.bundleId])).toEqual([
      ["live_activity_tokens", "tok-new", "com.example.app.dev"],
      ["device_push_tokens", "tok-old", "com.example.app"],
    ]);
  });

  it("doesn't list the legacy token twice when it's also stored per app", () => {
    const targets = pushTargetsByUser(
      [row("1", "u1", "tok", "com.example.app", "2026-11-26T10:00:00Z")],
      [{ id: "L", user_id: "u1", push_to_start_token: "tok" }],
      fallback
    ).get("u1")!;
    expect(targets).toHaveLength(1);
  });

  it("keeps users apart", () => {
    const byUser = pushTargetsByUser([], [{ id: "L1", user_id: "u1", push_to_start_token: "a" }, { id: "L2", user_id: "u2", push_to_start_token: "b" }], fallback);
    expect(byUser.get("u1")!.map((t) => t.token)).toEqual(["a"]);
    expect(byUser.get("u2")!.map((t) => t.token)).toEqual(["b"]);
  });
});

describe("isDeadToken", () => {
  it("treats tokens for the wrong app, bad tokens and uninstalled apps as dead", () => {
    expect(isDeadToken(400, '{"reason":"DeviceTokenNotForTopic"}')).toBe(true);
    expect(isDeadToken(400, '{"reason":"BadDeviceToken"}')).toBe(true);
    expect(isDeadToken(410, '{"reason":"Unregistered"}')).toBe(true);
  });

  it("keeps the token on errors that may pass", () => {
    expect(isDeadToken(429, '{"reason":"TooManyRequests"}')).toBe(false);
    expect(isDeadToken(500, "")).toBe(false);
    expect(isDeadToken(400, '{"reason":"PayloadTooLarge"}')).toBe(false);
    expect(isDeadToken(403, '{"reason":"ExpiredProviderToken"}')).toBe(false);
  });
});

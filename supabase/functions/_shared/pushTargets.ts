// Which phone app(s) to push a Live Activity to, and when a token is dead.
//
// The dev build ("Aidha (Dev)", bundle id ending ".dev") and the TestFlight /
// App Store build are separate apps to iOS: each has its own push-to-start
// token, its own APNs topic (bundle id) and its own APNs environment. Tokens
// are stored per app in live_activity_tokens. The older device_push_tokens
// table held one token per user, so whichever app was opened last replaced
// the other's - and pushes then went to the wrong app. It's still read, as a
// fallback, for app versions that only know that table.

export type ApnsEnvironment = "sandbox" | "production";

export interface PushTarget {
  table: "live_activity_tokens" | "device_push_tokens";
  id: string;
  token: string;
  bundleId: string;
  environment: ApnsEnvironment;
}

export interface TokenRow {
  id: string;
  user_id: string;
  push_to_start_token: string;
  bundle_id: string;
  apns_environment: ApnsEnvironment;
  updated_at: string;
}

export interface LegacyTokenRow {
  id: string;
  user_id: string;
  push_to_start_token: string;
}

// Per user, the targets to try in order: the app opened most recently first
// (only one Live Activity is wanted, not one per installed app), then the
// legacy token - sent with the server's configured bundle id and environment -
// unless it's the same token as one already listed.
export function pushTargetsByUser(
  rows: TokenRow[],
  legacyRows: LegacyTokenRow[],
  fallback: { bundleId: string; environment: ApnsEnvironment }
): Map<string, PushTarget[]> {
  const byUser = new Map<string, PushTarget[]>();
  const sorted = [...rows].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  for (const row of sorted) {
    const list = byUser.get(row.user_id) ?? [];
    list.push({
      table: "live_activity_tokens",
      id: row.id,
      token: row.push_to_start_token,
      bundleId: row.bundle_id,
      environment: row.apns_environment,
    });
    byUser.set(row.user_id, list);
  }
  for (const row of legacyRows) {
    const list = byUser.get(row.user_id) ?? [];
    if (list.some((t) => t.token === row.push_to_start_token)) continue;
    list.push({
      table: "device_push_tokens",
      id: row.id,
      token: row.push_to_start_token,
      bundleId: fallback.bundleId,
      environment: fallback.environment,
    });
    byUser.set(row.user_id, list);
  }
  return byUser;
}

// Whether APNs says this token will never work for this app - it was
// uninstalled, or the token belongs to a different app or environment. Such a
// token is deleted rather than retried every minute.
export function isDeadToken(status: number, body: string): boolean {
  if (status === 410) return true;
  if (status !== 400) return false;
  return /"reason"\s*:\s*"(BadDeviceToken|DeviceTokenNotForTopic|Unregistered)"/.test(body);
}

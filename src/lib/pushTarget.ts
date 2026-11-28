// Which app this is, as APNs sees it. The dev build gets its own bundle id
// ending ".dev" (see app.config.ts) and, being development-signed, talks to the
// APNs sandbox; TestFlight and App Store builds use production. The server
// needs both to push a Live Activity to the right app.
export function pushTargetForBundle(bundleId: string): {
  bundle_id: string;
  apns_environment: "sandbox" | "production";
} {
  return { bundle_id: bundleId, apns_environment: bundleId.endsWith(".dev") ? "sandbox" : "production" };
}

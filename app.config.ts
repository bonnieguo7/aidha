import type { ConfigContext, ExpoConfig } from "expo/config";

// Set by eas.json's "development"/"development-device" build profiles (see
// their "env" block) - never set for "preview"/"production", so those keep
// app.json's plain values untouched.
const IS_DEV = process.env.APP_VARIANT === "development";

// A dev-client build and a production/TestFlight build sharing one bundle
// identifier register the same custom URL scheme for the dev-client QR code
// deep link - iOS then has two installed apps claiming it and silently picks
// one, with no way to control which. Giving dev builds their own identifier
// (and a distinguishable name) makes them a genuinely separate app on the
// device instead of an ambiguous, visually-identical duplicate.
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: IS_DEV ? `${config.name} (Dev)` : (config.name as string),
  ios: {
    ...config.ios,
    bundleIdentifier: IS_DEV ? `${config.ios?.bundleIdentifier}.dev` : config.ios?.bundleIdentifier,
  },
});

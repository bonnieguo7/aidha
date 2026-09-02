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
export default ({ config }: ConfigContext): ExpoConfig => {
  // app.json (the static base config) always supplies every field ExpoConfig
  // requires - ConfigContext's own type just can't express that guarantee,
  // since in principle a dynamic config could be the *only* config file.
  const base = config as ExpoConfig;
  return {
    ...base,
    name: IS_DEV ? `${base.name} (Dev)` : base.name,
    ios: {
      ...base.ios,
      bundleIdentifier: IS_DEV ? `${base.ios?.bundleIdentifier}.dev` : base.ios?.bundleIdentifier,
    },
  };
};

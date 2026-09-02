import { Image, ProgressView, Spacer, Text, VStack, HStack } from "@expo/ui/swift-ui";
import {
  font,
  foregroundStyle,
  frame,
  monospacedDigit,
  opacity,
  padding,
  progressViewStyle,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { addPushToStartTokenListener, createLiveActivity, type LiveActivityEnvironment } from "expo-widgets";
import { supabase } from "./supabase";

// Kept minimal and serializable - this crosses into native
// ActivityAttributes/ContentState, and its field names/casing must match
// what the start-live-activities edge function sends as "content-state" in
// the APNs push-to-start payload (see that function's sendPushToStart).
export interface DepartureActivityProps {
  taskTitle: string;
  locationLabel: string | null;
  eventTimeIso: string;
  leavingByIso: string;
}

function DepartureActivityView(props: DepartureActivityProps, environment: LiveActivityEnvironment) {
  "widget";
  // Defined locally rather than as a module-level helper - the "widget"
  // directive extracts/serializes this function's body into a separate
  // bundle for the widget extension at build time, and a call to a function
  // declared outside this scope doesn't get carried along (confirmed on
  // device: "Can't find variable: formatTime" when it lived at module scope).
  function formatTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  const accentColor = environment.colorScheme === "dark" ? "#F2A6AE" : "#A34C59";

  const leavingBy = new Date(props.leavingByIso);
  // Text/ProgressView's timerInterval ticks live on-device with no further
  // pushes needed - "lower" just anchors the ring's 0%/100% ends, so use the
  // moment this push-to-start window opened (15 min before leaving_by, see
  // RECHECK_WINDOW_START_MINUTES in the start-live-activities edge function)
  // rather than "now" at render time, which would jump the ring on every
  // re-render instead of filling smoothly.
  const windowStart = new Date(leavingBy.getTime() - 15 * 60_000);
  const countdown = { lower: windowStart, upper: leavingBy };

  // A circular ProgressView(timerInterval:) already renders its own live
  // countdown number inside the ring in a Live Activity context - an extra
  // overlaid Text(timerInterval:) on top of it produced two overlapping
  // copies of the same ticking number on device, so "LEAVE IN" is a caption
  // below the ring instead of stacked inside it.
  const ring = (size: number, labelSize: number) => (
    <VStack spacing={2}>
      <ProgressView
        timerInterval={countdown}
        countsDown
        modifiers={[progressViewStyle("circular"), tint(accentColor), frame({ width: size, height: size })]}
      />
      <Text modifiers={[font({ size: labelSize }), foregroundStyle(accentColor)]}>LEAVE IN</Text>
    </VStack>
  );

  return {
    banner: (
      <HStack modifiers={[padding({ all: 12 })]}>
        {/* The ring lives at this top level, as a sibling of the whole text
            column, rather than inside the same row the alignment is
            supposed to control - nesting it alongside the text inside the
            "leading"-aligned row didn't actually line anything up on
            device across several attempts, so it's pulled out here instead. */}
        <VStack alignment="leading" spacing={10}>
          <HStack spacing={6}>
            <Image systemName="sparkles" color={accentColor} size={13} />
            <Text modifiers={[font({ weight: "semibold", size: 12 })]}>Aidha</Text>
          </HStack>
          <HStack spacing={6}>
            {/* Invisible copy of the header row's icon (same size, same
                spacing) so this text's leading edge lines up with "Aidha"
                specifically, not the icon. */}
            <Image systemName="sparkles" size={13} modifiers={[opacity(0)]} />
            <VStack alignment="leading" spacing={2}>
              <Text modifiers={[font({ weight: "bold", size: 14 })]}>{props.taskTitle}</Text>
              {props.locationLabel && (
                <Text modifiers={[font({ size: 13 }), foregroundStyle(accentColor)]}>{props.locationLabel}</Text>
              )}
              <Text modifiers={[font({ size: 13 })]}>
                {formatTime(props.eventTimeIso)} · depart {formatTime(props.leavingByIso)}
              </Text>
            </VStack>
          </HStack>
        </VStack>
        <Spacer />
        {ring(78, 8)}
      </HStack>
    ),
    compactLeading: <Image systemName="figure.walk.departure" color={accentColor} />,
    compactTrailing: (
      <Text timerInterval={countdown} countsDown modifiers={[monospacedDigit(), foregroundStyle(accentColor)]} />
    ),
    minimal: <Image systemName="figure.walk.departure" color={accentColor} />,
    expandedLeading: (
      <VStack modifiers={[padding({ all: 12 })]}>
        <Image systemName="figure.walk.departure" color={accentColor} />
        <Text modifiers={[font({ size: 12 })]}>Leaving soon</Text>
      </VStack>
    ),
    expandedTrailing: ring(68, 7),
    expandedBottom: (
      <VStack modifiers={[padding({ all: 12 })]}>
        <Text modifiers={[font({ weight: "bold" })]}>{props.taskTitle}</Text>
        {props.locationLabel && (
          <HStack>
            <Text>{props.locationLabel}</Text>
          </HStack>
        )}
      </VStack>
    ),
  };
}

// Wrapped defensively, same reasoning as registerPushToStartListener below:
// this runs unconditionally at module load (AuthContext imports this file),
// so on a dev-client build that predates the expo-widgets native module,
// this must not throw and take down every screen with it.
export const DepartureLiveActivity = (() => {
  try {
    return createLiveActivity("DepartureActivity", DepartureActivityView);
  } catch (err) {
    console.error("liveActivity: createLiveActivity unavailable", err);
    return null;
  }
})();

// Registers this device for remote push-to-start and upserts the token to
// Supabase - the server (start-live-activities edge function, run on a
// cron) uses it to start a Live Activity even if the app isn't open, once a
// task's leaving_by is 15 minutes out. Call once per signed-in session (see
// AuthContext); safe to call repeatedly since it just upserts. Returns an
// unsubscribe function.
export function registerPushToStartListener(): () => void {
  // expo-widgets' native module isn't in a dev-client build until that
  // build is rebuilt with this plugin included - guard the same way the
  // rest of this app treats risky native calls (see getCurrentUserLocation)
  // so a stale build degrades to "no Live Activity yet" instead of crashing
  // every screen that mounts AuthProvider.
  try {
    const subscription = addPushToStartTokenListener(async (event) => {
      const token = event.activityPushToStartToken;
      if (!token) return;

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;

      const { error } = await supabase.from("device_push_tokens").upsert(
        { user_id: userData.user.id, push_to_start_token: token, platform: "ios" },
        { onConflict: "user_id,platform" }
      );
      if (error) console.error("liveActivity: failed to persist push-to-start token", error);
    });

    return () => subscription.remove();
  } catch (err) {
    console.error("liveActivity: push-to-start registration unavailable", err);
    return () => {};
  }
}

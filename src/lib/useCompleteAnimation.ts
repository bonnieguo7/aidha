import { useRef } from "react";
import * as Haptics from "expo-haptics";
import { Animated, LayoutAnimation, Platform, UIManager } from "react-native";

// Older Android (pre-Fabric) needs this opt-in for LayoutAnimation to do
// anything; harmless no-op everywhere else (iOS, and the new architecture).
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// expo-haptics is a native module - on a dev-client binary built before it
// was added, the native side isn't linked yet and notificationAsync rejects.
// Swallow that so a missing rebuild degrades to "no buzz" instead of an
// unhandled promise rejection breaking the completion flow.
function playHaptic() {
  try {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  } catch {
    // native module not linked in this binary yet - ignore.
  }
}

// Shared "check something off" feel for any row that can be completed: a
// success haptic on tap, then a quick fade + shrink of that row before the
// caller's own onComplete (the async save + state removal) actually runs -
// by the time the network call resolves the row is already invisible, so its
// removal from the list never causes a visible jump.
export function useCompleteAnimation() {
  const progress = useRef(new Animated.Value(0)).current;

  const animatedStyle = {
    opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.92] }) }],
  };

  function playComplete(onComplete: () => void) {
    playHaptic();
    Animated.timing(progress, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start(() => onComplete());
  }

  return { animatedStyle, playComplete };
}

// Call right before removing a completed item from list state, so the
// remaining rows slide up to fill the gap instead of snapping into place.
export function configureRemovalAnimation() {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}

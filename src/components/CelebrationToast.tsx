import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../lib/theme";

export interface Celebration {
  // Changes for every celebration, so the same message twice still replays.
  id: number;
  title: string;
}

const HOLD_MS = 1600;

// A small toast that drops in at the top of the screen after a task is
// completed. Never blocks touches.
export default function CelebrationToast({
  celebration,
  onDone,
}: {
  celebration: Celebration | null;
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const appear = useRef(new Animated.Value(0)).current;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!celebration) return;
    appear.setValue(0);
    const animation = Animated.sequence([
      Animated.spring(appear, { toValue: 1, friction: 6, useNativeDriver: true }),
      Animated.delay(HOLD_MS),
      Animated.timing(appear, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]);
    animation.start(({ finished }) => {
      if (finished) onDoneRef.current();
    });
    return () => animation.stop();
    // Keyed on the id: each new celebration restarts the animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [celebration?.id]);

  if (!celebration) return null;

  return (
    <View style={[styles.wrap, { top: insets.top + 8 }]}>
      <Animated.View
        accessibilityLiveRegion="polite"
        style={[
          styles.toast,
          {
            opacity: appear,
            transform: [
              { translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) },
              { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
            ],
          },
        ]}
      >
        <Text style={styles.title}>{celebration.title}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    pointerEvents: "none",
  },
  toast: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 18,
    paddingVertical: 10,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textPrimary,
  },
});

// lib/components/Motion.tsx
import { useEffect, type ReactNode } from 'react';
import { Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

/** The app's motion vocabulary - short, functional, and quiet, in keeping
 * with the flat "Trusted Toolbelt" look (see DESIGN.md → Motion). Everything
 * is time-based rather than springy so it behaves the same on iOS, Android
 * and the web build, and everything honours the system "reduce motion"
 * setting: the animation is skipped and the content just appears.
 *
 * Only Reanimated's built-in presets are used for entering / exiting /
 * layout on purpose. On the web build a custom keyframe, custom starting
 * values or a custom easing either falls back to linear or leaves the view
 * stuck at `position: absolute`, so it stops taking up room and the blocks
 * below it slide underneath. The presets don't. */

const STAGGER_MS = 40;
const MAX_STAGGER = 6;
const OUT = Easing.out(Easing.cubic);

/** A block settling into place: fades in while rising a little. `index`
 * staggers a run of siblings, capped so a long list never feels slow. */
export function riseIn(index = 0) {
  return FadeInDown.duration(240)
    .delay(Math.min(index, MAX_STAGGER) * STAGGER_MS)
    .reduceMotion(ReduceMotion.System);
}

const fadeOut = FadeOut.duration(160).reduceMotion(ReduceMotion.System);
const fadeIn = FadeIn.duration(200).reduceMotion(ReduceMotion.System);

/** When a sibling leaves or arrives, the rest glide to their new place
 * instead of jumping. */
const settle = LinearTransition.duration(220).reduceMotion(ReduceMotion.System);

/** Wrap one block of a screen. It rises in when it first appears (a card
 * arriving by realtime does too), fades out when it goes, and the blocks
 * around it slide into the gap. Give it the `key` of the thing it holds. */
export function Rise({ index = 0, style, children }: { index?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return (
    <Animated.View entering={riseIn(index)} exiting={fadeOut} layout={settle} style={style}>
      {children}
    </Animated.View>
  );
}

/** Same arrival for a small piece (a section title) that shouldn't travel. */
export function Appear({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return (
    <Animated.View entering={fadeIn} exiting={fadeOut} layout={settle} style={style}>
      {children}
    </Animated.View>
  );
}

type PressScaleProps = Omit<PressableProps, 'style'> & {
  /** How far it shrinks while held. Buttons 0.97, whole cards a touch less. */
  scaleTo?: number;
  /** Style for the Pressable itself (background, border, padding...). */
  style?: PressableProps['style'];
  /** Style for the wrapper that scales - e.g. `{ flex: 1 }` for a button in a row. */
  wrapStyle?: StyleProp<ViewStyle>;
};

/** A Pressable that shrinks slightly while it is held and springs back, so a
 * tap is felt before anything else happens. The press feedback is the only
 * change - layout, classes and handlers are the Pressable's own. */
export function PressScale({ scaleTo = 0.97, wrapStyle, disabled, onPressIn, onPressOut, children, ...rest }: PressScaleProps) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={[wrapStyle, animated]}>
      <Pressable
        {...rest}
        disabled={disabled}
        onPressIn={(e) => {
          if (!reduceMotion && !disabled) scale.value = withTiming(scaleTo, { duration: 90, easing: OUT });
          onPressIn?.(e);
        }}
        onPressOut={(e) => {
          scale.value = withTiming(1, { duration: 150, easing: OUT });
          onPressOut?.(e);
        }}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

/** A slow breathing fade for placeholders that stand in for content that is
 * still loading. Holds still when the user prefers reduced motion. */
export function Pulse({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) {
      opacity.value = 1;
      return;
    }
    opacity.value = withRepeat(
      withSequence(withTiming(0.5, { duration: 750, easing: Easing.inOut(Easing.quad) }), withTiming(1, { duration: 750, easing: Easing.inOut(Easing.quad) })),
      -1
    );
    return () => cancelAnimation(opacity);
  }, [reduceMotion, opacity]);

  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  // Two layers: the outer one only fades out when the placeholders go, the
  // inner one only breathes. Both touch opacity, and one view can't do both.
  return (
    <Animated.View exiting={fadeOut} style={style}>
      <Animated.View style={animated}>{children}</Animated.View>
    </Animated.View>
  );
}

/** What a job card looks like before its data arrives: the same box, with
 * grey bars where the text will be. */
export function JobCardSkeleton() {
  return (
    <View className="mb-3 rounded-2xl border border-gray-200 bg-white p-4">
      <View className="flex-row items-start gap-3">
        <View className="items-center gap-1.5">
          <View className="h-11 w-11 rounded-xl bg-gray-100" />
          <View className="h-11 w-11 rounded-lg bg-gray-100" />
        </View>
        <View className="flex-1">
          <View className="flex-row items-start justify-between gap-2">
            <View className="h-4 flex-1 rounded-md bg-gray-100" />
            <View className="h-4 w-14 rounded-full bg-gray-100" />
          </View>
          <View className="mt-2 h-3 w-4/5 rounded-md bg-gray-100" />
          <View className="mt-3 h-3 w-2/5 rounded-md bg-gray-100" />
          <View className="mt-1.5 h-3 w-3/5 rounded-md bg-gray-100" />
        </View>
      </View>
      <View className="mt-3 h-10 rounded-xl bg-gray-100" />
    </View>
  );
}

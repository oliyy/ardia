import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing } from "react-native";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useTabLive } from "../../store/hooks";
import { pageProgressOf, watchPageProgress } from "../../store/pageProgress";
import { useAddressBarInSidebar } from "./windowLayout";

const HEIGHT = 2;
const APPEAR_DELAY_MS = 120;
const APPEAR_MS = 120;
const STEP_MS = 240;
const FINISH_MS = 180;
const FADE_MS = 200;
const CREEP_MS_PER_WIDTH = 60_000;
const START = 0.08;
const CAP = 0.9;
const STEP_EASING = Easing.out(Easing.cubic);
const CREEP_EASING = Easing.out(Easing.quad);
const FADE_EASING = Easing.out(Easing.quad);

const shownFor = (progress: number) => START + (CAP - START) * Math.min(1, Math.max(0, progress));

export function CardLoadingLine({ tabId }: { tabId: string }) {
  const theme = useTheme();
  const inSidebar = useAddressBarInSidebar();
  const hasPage = useBrowser((s) => !!(s.tabs[tabId]?.url || s.tabs[tabId]?.navigation));
  if (!inSidebar || !hasPage) return null;
  return <LoadingLine tabId={tabId} color={theme.accent} />;
}

function LoadingLine({ tabId, color }: { tabId: string; color: string }) {
  const loading = useTabLive(tabId, (l) => l.isLoading);
  const seq = useBrowser((s) => s.tabs[tabId]?.navigation?.seq);
  const [line] = useState(lineMotion);
  const [width, setWidth] = useState(0);
  const mounting = useRef(true);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then(
      (on) => mounted && line.reduceMotion(on),
      () => {},
    );
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", line.reduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
      line.dispose();
    };
  }, []);
  useEffect(() => watchPageProgress(tabId, () => line.advance(pageProgressOf(tabId))), [tabId]);
  useEffect(() => {
    const alreadyRunning = mounting.current;
    mounting.current = false;
    if (!loading) {
      line.finish();
      return;
    }
    const reported = pageProgressOf(tabId);
    line.start(alreadyRunning && reported < 1 ? reported : 0);
  }, [loading, seq]);
  const offset = useMemo(() => line.fill.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] }), [width]);
  return (
    <Animated.View
      pointerEvents="none"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ position: "absolute", top: 0, left: 0, right: 0, height: HEIGHT, overflow: "hidden", opacity: line.opacity }}
    >
      {width > 0 && <Animated.View style={{ width, height: HEIGHT, backgroundColor: color, transform: [{ translateX: offset }] }} />}
    </Animated.View>
  );
}

type Phase = "idle" | "waiting" | "shown" | "finishing";

function lineMotion() {
  const fill = new Animated.Value(0);
  const opacity = new Animated.Value(0);
  let phase: Phase = "idle";
  let reduced = false;
  let turn = 0;
  let target = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let segment = { from: 0, to: 0, at: 0, ms: 0, easing: STEP_EASING };

  const position = () => {
    const t = segment.ms ? Math.min(1, (performance.now() - segment.at) / segment.ms) : 1;
    return segment.from + (segment.to - segment.from) * segment.easing(t);
  };
  const halt = () => {
    turn++;
    clearTimeout(timer);
    timer = undefined;
  };
  const place = (value: number) => {
    segment = { from: value, to: value, at: 0, ms: 0, easing: STEP_EASING };
    fill.setValue(value);
  };
  const move = (to: number, ms: number, easing: (t: number) => number, then?: () => void) => {
    const from = position();
    const mine = ++turn;
    segment = { from, to, at: performance.now(), ms, easing };
    Animated.timing(fill, { toValue: to, duration: ms, easing, useNativeDriver: true }).start(({ finished }) => {
      if (finished && mine === turn) then?.();
    });
  };
  const creep = () => {
    const from = position();
    if (from < CAP) move(CAP, (CAP - from) * CREEP_MS_PER_WIDTH, CREEP_EASING);
  };
  const toward = () => {
    const from = position();
    if (reduced) {
      if (target > from) place(target);
    } else if (target > from) move(target, STEP_MS, STEP_EASING, creep);
    else if (!segment.ms) creep();
  };
  const show = () => {
    phase = "shown";
    place(START);
    if (reduced) opacity.setValue(1);
    else Animated.timing(opacity, { toValue: 1, duration: APPEAR_MS, easing: FADE_EASING, useNativeDriver: true }).start();
    toward();
  };
  const reset = () => {
    phase = "idle";
    place(0);
    opacity.setValue(0);
  };

  return {
    fill,
    opacity,
    reduceMotion(on: boolean) {
      if (on === reduced) return;
      reduced = on;
      if (!on || (phase !== "shown" && phase !== "finishing")) return;
      halt();
      fill.stopAnimation();
      opacity.stopAnimation();
      if (phase === "finishing") return reset();
      place(Math.max(position(), target));
      opacity.setValue(1);
    },
    start(seed: number) {
      const visible = phase === "shown" || phase === "finishing";
      halt();
      target = shownFor(seed);
      if (visible) return show();
      reset();
      phase = "waiting";
      const mine = turn;
      timer = setTimeout(() => mine === turn && show(), APPEAR_DELAY_MS);
    },
    advance(progress: number) {
      if (phase !== "waiting" && phase !== "shown") return;
      const next = shownFor(progress);
      if (next <= target) return;
      target = next;
      if (phase === "shown") toward();
    },
    finish() {
      if (phase === "waiting") {
        halt();
        phase = "idle";
        return;
      }
      if (phase !== "shown") return;
      phase = "finishing";
      if (reduced) {
        halt();
        place(1);
        const mine = turn;
        timer = setTimeout(() => mine === turn && reset(), FINISH_MS);
        return;
      }
      move(1, FINISH_MS, FADE_EASING);
      const mine = turn;
      Animated.timing(opacity, { toValue: 0, duration: FADE_MS, delay: FINISH_MS, easing: FADE_EASING, useNativeDriver: true }).start(({ finished }) => {
        if (finished && mine === turn) reset();
      });
    },
    dispose() {
      halt();
      phase = "idle";
      fill.stopAnimation();
      opacity.stopAnimation();
    },
  };
}

import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing } from "react-native";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useTabLive } from "../../store/hooks";
import { pageProgressOf, watchPageProgress } from "../../store/pageProgress";
import { useAddressBarInSidebar } from "./windowLayout";

const HEIGHT = 2;
const APPEAR_DELAY_MS = 120;
const APPEAR_MS = 180;
const STEP_MS = 520;
const SETTLE_MS = 150;
const FINISH_MS = 320;
const FADE_DELAY_MS = 160;
const FADE_MS = 280;
const CREEP_MS_PER_WIDTH = 60_000;
const CREEP_VELOCITY = 2 / CREEP_MS_PER_WIDTH;
const START = 0.08;
const CAP = 0.9;
const CREEP_CAP = 0.97;
const APPEAR_EASING = Easing.out(Easing.quad);
const FADE_EASING = Easing.inOut(Easing.quad);

const shownFor = (progress: number) => START + (CAP - START) * Math.min(1, Math.max(0, progress));
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

const hermite = (m0: number, m1: number) => (t: number) => (t * t * t - 2 * t * t + t) * m0 + (3 * t * t - 2 * t * t * t) + (t * t * t - t * t) * m1;
const hermiteSlope = (m0: number, m1: number, t: number) => (3 * t * t - 4 * t + 1) * m0 + (6 * t - 6 * t * t) + (3 * t * t - 2 * t) * m1;

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
  const lastSeq = useRef(seq);
  useEffect(() => {
    const alreadyRunning = mounting.current;
    mounting.current = false;
    const navigated = seq !== lastSeq.current;
    lastSeq.current = seq;
    if (!loading) {
      line.finish();
      return;
    }
    const reported = pageProgressOf(tabId);
    line.start(alreadyRunning && reported < 1 ? reported : 0, navigated);
  }, [loading, seq]);
  return useMemo(() => {
    const offset = line.fill.interpolate({ inputRange: [0, 1], outputRange: [-width, 0], extrapolate: "clamp" });
    return (
      <Animated.View
        pointerEvents="none"
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: HEIGHT, overflow: "hidden", opacity: line.opacity }}
      >
        {width > 0 && <Animated.View style={{ width, height: HEIGHT, backgroundColor: color, transform: [{ translateX: offset }] }} />}
      </Animated.View>
    );
  }, [width, color]);
}

type Phase = "idle" | "waiting" | "shown" | "settling" | "finishing";

function lineMotion() {
  const fill = new Animated.Value(0);
  const opacity = new Animated.Value(0);
  let phase: Phase = "idle";
  let reduced = false;
  let turn = 0;
  let target = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let segment = { from: 0, to: 0, at: 0, ms: 0, m0: 0, m1: 0 };

  const progressAt = (now: number) => (segment.ms ? Math.min(1, (now - segment.at) / segment.ms) : 1);
  const position = (now: number) => segment.from + (segment.to - segment.from) * hermite(segment.m0, segment.m1)(progressAt(now));
  const ahead = (now: number) => {
    const later = now + STEP_MS;
    return position(later) + CREEP_VELOCITY * Math.max(0, later - Math.max(now, segment.at + segment.ms));
  };
  const velocity = (now: number) => {
    const t = progressAt(now);
    return t < 1 ? ((segment.to - segment.from) * hermiteSlope(segment.m0, segment.m1, t)) / segment.ms : 0;
  };
  const wait = (ms: number, then: () => void) => {
    clearTimeout(timer);
    timer = setTimeout(then, ms);
  };
  const halt = () => {
    turn++;
    clearTimeout(timer);
    timer = undefined;
  };
  const place = (value: number) => {
    segment = { from: value, to: value, at: 0, ms: 0, m0: 0, m1: 0 };
    fill.setValue(value);
  };
  const move = (to: number, ms: number, endVelocity: number, then?: () => void, startVelocity?: number) => {
    const now = performance.now();
    const from = position(now);
    const distance = to - from;
    const slope = (speed: number) => (Math.abs(distance) < 1e-4 ? 0 : (speed * ms) / distance);
    const m0 = clamp(slope(startVelocity ?? velocity(now)), -2, 2.5);
    const m1 = clamp(slope(endVelocity), 0, 1);
    const mine = ++turn;
    segment = { from, to, at: now, ms, m0, m1 };
    Animated.timing(fill, { toValue: to, duration: ms, easing: hermite(m0, m1), useNativeDriver: true }).start(({ finished }) => {
      if (finished && mine === turn) then?.();
    });
  };
  const creep = () => {
    const from = position(performance.now());
    if (from < CREEP_CAP) move(CREEP_CAP, (CREEP_CAP - from) * CREEP_MS_PER_WIDTH, 0, undefined, CREEP_VELOCITY);
  };
  const toward = () => {
    const now = performance.now();
    const from = position(now);
    if (reduced) {
      if (target > from) place(target);
    } else if (target > ahead(now)) move(target, STEP_MS, CREEP_VELOCITY, creep);
    else if (progressAt(now) >= 1) creep();
  };
  const show = () => {
    phase = "shown";
    if (reduced) {
      place(target);
      opacity.setValue(1);
      return;
    }
    Animated.timing(opacity, { toValue: 1, duration: APPEAR_MS, easing: APPEAR_EASING, useNativeDriver: true }).start();
    move(target, STEP_MS, CREEP_VELOCITY, creep, (2 * target) / STEP_MS);
  };
  const reset = () => {
    phase = "idle";
    place(0);
    opacity.setValue(0);
  };
  const sweep = () => {
    phase = "finishing";
    if (reduced) {
      halt();
      place(1);
      wait(FINISH_MS, reset);
      return;
    }
    move(1, FINISH_MS, (1 - position(performance.now())) / FINISH_MS);
    const mine = turn;
    Animated.timing(opacity, { toValue: 0, duration: FADE_MS, delay: FADE_DELAY_MS, easing: FADE_EASING, useNativeDriver: true }).start(({ finished }) => {
      if (finished && mine === turn) reset();
    });
  };

  return {
    fill,
    opacity,
    reduceMotion(on: boolean) {
      if (on === reduced) return;
      reduced = on;
      if (!on || phase === "idle" || phase === "waiting") return;
      halt();
      fill.stopAnimation();
      opacity.stopAnimation();
      if (phase === "finishing") return reset();
      place(Math.max(position(performance.now()), target));
      opacity.setValue(1);
      if (phase === "settling") wait(SETTLE_MS, sweep);
    },
    start(seed: number, navigated: boolean) {
      const next = shownFor(seed);
      if (phase === "idle") {
        target = next;
        phase = "waiting";
        wait(APPEAR_DELAY_MS, show);
        return;
      }
      if (phase === "waiting") {
        target = navigated ? next : Math.max(target, next);
        return;
      }
      let rewind = navigated;
      if (phase === "settling") clearTimeout(timer);
      if (phase === "finishing") {
        rewind = true;
        halt();
        if (reduced) opacity.setValue(1);
        else Animated.timing(opacity, { toValue: 1, duration: APPEAR_MS, easing: APPEAR_EASING, useNativeDriver: true }).start();
      }
      phase = "shown";
      if (!rewind) return;
      target = next;
      if (reduced) place(target);
      else move(target, STEP_MS, CREEP_VELOCITY, creep);
    },
    advance(progress: number) {
      if (phase !== "waiting" && phase !== "shown" && phase !== "settling") return;
      const next = shownFor(progress);
      if (next <= target) return;
      target = next;
      if (phase !== "waiting") toward();
    },
    finish() {
      if (phase === "waiting") {
        halt();
        phase = "idle";
        return;
      }
      if (phase !== "shown") return;
      phase = "settling";
      wait(SETTLE_MS, sweep);
    },
    dispose() {
      halt();
      phase = "idle";
      fill.stopAnimation();
      opacity.stopAnimation();
    },
  };
}

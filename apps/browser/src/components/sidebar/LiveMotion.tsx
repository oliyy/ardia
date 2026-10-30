import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Animated, View } from "react-native";
import { Surface } from "../ui";
import { curve } from "../ui/motion";
import { newSlide, shiftAt, type Slide, type SlideTiming } from "./listPlan";

export const AnimatedSurface = Animated.createAnimatedComponent(Surface);

export function springTiming(response: number, dampingRatio: number): SlideTiming {
  const omega = (2 * Math.PI) / response;
  const decay = dampingRatio * omega;
  const ringing = omega * Math.sqrt(1 - dampingRatio * dampingRatio);
  const seconds = Math.log(1000) / decay;
  const progress = (s: number) => 1 - Math.exp(-decay * s) * (Math.cos(ringing * s) + (decay / ringing) * Math.sin(ringing * s));
  return { ms: Math.round(seconds * 1000), easing: (t) => (t >= 1 ? 1 : progress(t * seconds)) };
}

export const ROW_SPRING = springTiming(0.42, 0.86);
const POP_SPRING = springTiming(0.38, 0.62);
const FADE_IN: SlideTiming = { ms: 220, easing: curve.outCubic };
const APPEAR_WAIT = 0.3;
const APPEAR_FADE: SlideTiming = { ms: 320, easing: (t) => (t <= APPEAR_WAIT ? 0 : curve.outCubic((t - APPEAR_WAIT) / (1 - APPEAR_WAIT))) };
const FADE_OUT: SlideTiming = { ms: 160, easing: curve.outQuad };
const POP_FROM = 0.55;
const EXIT_TO = 0.8;
const APPEAR_LIFT = -8;
const STILL = 0.25;
const CROSS_DIM = 0.3;
const CROSSING: SlideTiming = { ms: 320, easing: (t) => t };

function play(slide: Slide, from: number, to: number, timing: SlideTiming, landed?: () => void) {
  if (slide.live) slide.superseded += 1;
  slide.value.setValue(from);
  const at = Date.now();
  Object.assign(slide, { from, at, until: at + timing.ms, ms: timing.ms, easing: timing.easing, landed: false, live: true });
  Animated.timing(slide.value, { toValue: to, duration: timing.ms, easing: timing.easing, useNativeDriver: true }).start(({ finished }) => {
    if (slide.at !== at) return;
    slide.live = false;
    if (!finished) return;
    slide.landed = true;
    slide.value.setValue(to);
    if (landed) void Promise.resolve().then(landed);
  });
}

function settle(slide: Slide, to: number) {
  if (!slide.live) return;
  slide.superseded += 1;
  slide.at = Date.now();
  slide.live = false;
  slide.value.setValue(to);
}

type MorphMotion = { enter: Slide; exit: Slide; enterStyle: object; exitStyle: object };

function morphMotion(): MorphMotion {
  const enter = newSlide(1, 0, POP_SPRING);
  const exit = newSlide(0, 0, FADE_OUT);
  return {
    enter,
    exit,
    enterStyle: {
      opacity: enter.value.interpolate({ inputRange: [0, 0.4], outputRange: [0, 1], extrapolate: "clamp" }),
      transform: [{ scale: enter.value.interpolate({ inputRange: [0, 1], outputRange: [POP_FROM, 1] }) }],
    },
    exitStyle: {
      position: "absolute",
      top: 0,
      bottom: 0,
      right: 0,
      justifyContent: "center",
      opacity: exit.value,
      transform: [{ scale: exit.value.interpolate({ inputRange: [0, 1], outputRange: [EXIT_TO, 1] }) }],
    },
  };
}

export function Morph({ state, animates, children }: { state: string; animates: () => boolean; children: ReactNode }) {
  const motion = useRef<MorphMotion | null>(null);
  motion.current ??= morphMotion();
  const { enter, exit, enterStyle, exitStyle } = motion.current;
  const last = useRef({ state, node: children });
  const previous = last.current;
  last.current = { state, node: children };
  const [leaving, setLeaving] = useState<ReactNode>(null);
  const turn = useRef(0);
  useLayoutEffect(() => {
    if (previous.state === state) return;
    const mine = ++turn.current;
    if (!animates()) {
      settle(enter, 1);
      settle(exit, 0);
      setLeaving(null);
      return;
    }
    setLeaving(previous.node);
    play(enter, 0, 1, POP_SPRING);
    play(exit, 1, 0, FADE_OUT, () => {
      if (turn.current === mine) setLeaving(null);
    });
  }, [state]);
  return (
    <View>
      <AnimatedSurface style={enterStyle}>{children}</AnimatedSurface>
      {leaving ? (
        <AnimatedSurface pointerEvents="none" hidesAccessibility style={exitStyle}>
          {leaving}
        </AnimatedSurface>
      ) : null}
    </View>
  );
}

export function Glide({ x, animates, children }: { x: number; animates: () => boolean; children: ReactNode }) {
  const motion = useRef<{ slide: Slide; style: object } | null>(null);
  motion.current ??= glideMotion();
  const { slide, style } = motion.current;
  const last = useRef(x);
  useLayoutEffect(() => {
    const from = last.current;
    last.current = x;
    if (from === x) return;
    if (!animates()) {
      settle(slide, 0);
      return;
    }
    play(slide, (slide.live ? shiftAt(slide, Date.now()) : 0) + from - x, 0, POP_SPRING);
  }, [x]);
  return <AnimatedSurface style={style}>{children}</AnimatedSurface>;
}

function glideMotion() {
  const slide = newSlide(0, 0, POP_SPRING);
  return { slide, style: { transform: [{ translateX: slide.value }] } };
}

export type PlacedRow = { key: string; y: number; parent: string | null; ghost: (() => ReactNode) | null };
export type RowPlacement = { rows: PlacedRow[]; height: number };

type Mover = { shift: Slide; fade: Slide; cross: Slide; style: object };
type RowGhostState = { key: string; y: number; node: ReactNode; fade: Slide; style: object };
type RowPlan = { moves: { key: string; from: number }[]; appears: string[]; crossings: string[]; ghosts: RowGhostState[]; delta: number };

let ghostIds = 0;

function newMover(shift: number, opacity: number): Mover {
  const moving = newSlide(shift, 0, ROW_SPRING);
  const fade = newSlide(opacity, 0, FADE_IN);
  const cross = newSlide(1, 0, CROSSING);
  const dim = cross.value.interpolate({ inputRange: [0, 0.12, 0.6, 1], outputRange: [1, CROSS_DIM, CROSS_DIM, 1] });
  return { shift: moving, fade, cross, style: { opacity: Animated.multiply(fade.value, dim), transform: [{ translateY: moving.value }] } };
}

export function useRowMotion<T>(source: T, ready: boolean, place: (source: T) => RowPlacement, slideBelow: (delta: number, timing: SlideTiming) => void) {
  const movers = useRef(new Map<string, Mover>()).current;
  const ghosts = useRef<RowGhostState[]>([]);
  const last = useRef(source);
  const queued = useRef<RowPlan | null>(null);
  const [, rerender] = useState(0);

  if (last.current !== source) {
    const before = last.current;
    last.current = source;
    if (ready) {
      const was = place(before);
      const now = place(source);
      const t = Date.now();
      const own = (key: string) => shiftAt(movers.get(key)?.shift, t);
      const shown = (row: PlacedRow) => row.y + own(row.key) + (row.parent ? own(row.parent) : 0);
      const previous = new Map(was.rows.map((row) => [row.key, row]));
      const kept = new Set(now.rows.map((row) => row.key));
      const offset = new Map<string, number>();
      for (const row of now.rows) {
        const old = previous.get(row.key);
        if (old) offset.set(row.key, shown(old) - row.y);
      }
      const moves: RowPlan["moves"] = [];
      for (const row of now.rows) {
        const total = offset.get(row.key);
        if (total === undefined) continue;
        const from = total - (row.parent ? (offset.get(row.parent) ?? 0) : 0);
        const mover = movers.get(row.key);
        if (Math.abs(from) < STILL && !mover?.shift.live) continue;
        if (!mover) movers.set(row.key, newMover(from, 1));
        moves.push({ key: row.key, from });
      }
      const crossings = farthestPassers(now.rows.filter((row) => offset.has(row.key)).map((row) => ({ key: row.key, was: row.y + offset.get(row.key)!, is: row.y })));
      const appears = now.rows.filter((row) => !previous.has(row.key)).map((row) => row.key);
      for (const key of appears) movers.set(key, newMover(APPEAR_LIFT, 0));
      const born = was.rows.flatMap((row): RowGhostState[] => {
        if (kept.has(row.key) || !row.ghost) return [];
        const fade = newSlide(1, t, FADE_OUT);
        return [{ key: `ghost:${++ghostIds}`, y: shown(row), node: row.ghost(), fade, style: { opacity: fade.value } }];
      });
      ghosts.current = [...ghosts.current, ...born];
      queued.current = { moves, appears, crossings, ghosts: born, delta: was.height - now.height };
      for (const key of movers.keys()) if (!kept.has(key)) movers.delete(key);
    }
  }

  useLayoutEffect(() => {
    const plan = queued.current;
    if (!plan) return;
    queued.current = null;
    for (const move of plan.moves) {
      const mover = movers.get(move.key);
      if (mover) play(mover.shift, move.from, 0, ROW_SPRING);
    }
    for (const key of plan.crossings) {
      const mover = movers.get(key);
      if (mover) play(mover.cross, 0, 1, CROSSING);
    }
    for (const key of plan.appears) {
      const mover = movers.get(key);
      if (!mover) continue;
      play(mover.shift, APPEAR_LIFT, 0, ROW_SPRING);
      play(mover.fade, 0, 1, APPEAR_FADE);
    }
    for (const ghost of plan.ghosts) {
      play(ghost.fade, 1, 0, FADE_OUT, () => {
        ghosts.current = ghosts.current.filter((g) => g !== ghost);
        rerender((n) => n + 1);
      });
    }
    if (plan.delta) slideBelow(plan.delta, ROW_SPRING);
  });

  return {
    style: (key: string): object | null => movers.get(key)?.style ?? null,
    ghosts: ghosts.current,
  };
}

function farthestPassers(rows: { key: string; was: number; is: number }[]): string[] {
  const passed = rows.map((a) => rows.filter((b) => b !== a && a.was < b.was !== a.is < b.is).length);
  const most = Math.max(0, ...passed);
  return most ? rows.filter((_, i) => passed[i] === most).map((row) => row.key) : [];
}

export function RowGhost({ top, style, children }: { top: number; style: object; children: ReactNode }) {
  return (
    <View pointerEvents="none">
      <AnimatedSurface hidesAccessibility style={[{ position: "absolute", left: 0, right: 0, top }, style]}>
        {children}
      </AnimatedSurface>
    </View>
  );
}

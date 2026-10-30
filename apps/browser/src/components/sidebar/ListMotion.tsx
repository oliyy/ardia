import { devRegister } from "../dev/devRegister";
import { createContext, memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Animated, View } from "react-native";
import { Surface } from "../ui";
import { layout, useTheme } from "../ui/theme";
import type { BrowserState } from "../../state/browser/store";
import { workspaceSnapshot } from "../../state/browser/current";
import { live } from "../../state/live/store";
import { movedBy, type Capture } from "../../state/sidebar/listCapture";
import { entryHeight, rootLift } from "../../state/sidebar/geometry";
import { liveHeightsNow } from "../../state/sidebar/pinnedTree";
import { entryId, entryKey } from "../../state/sidebar/entryKey";
import { addressBarInSidebar } from "../../state/windows/layout";
import { useAnimatedStyle, type ClipSource, type EntryMotion } from "./EntryMotion";
import { ghostEntry } from "./GhostEntry";
import { snapshotEntry, type EntrySnapshot } from "./ghostShots";
import {
  basisOf,
  buildPlan,
  closedIn,
  groupChange,
  groupGrowsAtEnd,
  newSlide,
  offsets,
  openedIn,
  prefixHeight,
  sharedPrefix,
  shiftAt,
  TAIL,
  type FoldSlideOptions,
  type Ghost,
  type GroupChange,
  type Height,
  type ListSlot,
  type Offsets,
  type Plan,
  type Planner,
  type Slide,
  type SlideTiming,
  type Snapshot,
} from "./listPlan";
import { SIDEBAR_MOTION, SLIDE_EASING, SLIDE_MS, useArcLabel } from "./tokens";
import { curve } from "../ui/motion";

const FADE_MS = SIDEBAR_MOTION.listFade;
const FADE_EASING = curve.cssEaseOut;
const GAP = layout.rowGap;
const FRAME_SLACK_MS = 50;
const devScale = () => (__DEV__ ? ((globalThis as { sidebarMotionScale?: number }).sidebarMotionScale ?? 1) : 1);

export type Boundary = (list: string[]) => { above: number; below: number };
export type FoldChain = (entry: string, delta: number, timing?: SlideTiming) => Animated.Value | null;
export type ListMotionScope = { enabled: boolean; slideBelow: ((entry: string, delta: number) => void) | null; fold?: { pinned: FoldChain; list: FoldChain } };

export const ListMotionContext = createContext<ListMotionScope>({ enabled: false, slideBelow: null });
export const FoldChainContext = createContext<FoldChain | null>(null);

type Core = {
  devKey: string;
  entries: string[];
  from: Capture;
  planner: Planner;
  height: (entry: string) => number;
  enabled: boolean;
  native: boolean;
  below?: ((delta: number) => void) | null;
};

function useMotion({ devKey, entries, from, planner, height, enabled, native, below }: Core) {
  const slides = useRef(new Map<string, Slide>()).current;
  const contexts = useRef(new Map<string, EntryMotion>()).current;
  const clipped = useRef(new Set<string>()).current;
  const watchers = useRef(new Map<string, Set<() => void>>()).current;
  const sources = useRef(new Map<string, ClipSource>()).current;
  const shown = useRef(new Set<string>()).current;
  const source = (key: string): ClipSource => {
    let known = sources.get(key);
    if (!known) {
      known = {
        clipped: () => clipped.has(key),
        subscribe: (changed) => {
          let set = watchers.get(key);
          if (!set) watchers.set(key, (set = new Set()));
          set.add(changed);
          return () => void set.delete(changed);
        },
      };
      sources.set(key, known);
    }
    return known;
  };
  const announce = () => {
    const changed = [...clipped].filter((k) => !shown.has(k)).concat([...shown].filter((k) => !clipped.has(k)));
    shown.clear();
    for (const key of clipped) shown.add(key);
    for (const key of changed) for (const notify of watchers.get(key) ?? []) notify();
  };
  const ghosts = useRef<Ghost[]>([]);
  const seen = useRef(entries);
  const latest = useRef(entries);
  latest.current = entries;
  const queued = useRef<Plan | null>(null);
  const clipping = useRef<object | null>(null);
  const [, rerender] = useState(0);
  if (enabled) devRegister("sidebarMotion", devKey, { slides, ghosts, clipped });

  const restart = (slide: Slide, to: number) => {
    if (native && slide.live) slide.superseded += 1;
    slide.value.setValue(to);
  };

  const now = Date.now();
  for (const slide of slides.values()) {
    if (slide.until && now >= slide.until) {
      slide.until = 0;
      if (!slide.landed) restart(slide, 0);
    }
  }
  if (ghosts.current.some((g) => g.until && now >= g.until)) ghosts.current = ghosts.current.filter((g) => !g.until || now < g.until);

  const prepare = (plan: Plan, at: number) => {
    for (const m of plan.moves) if (!slides.has(m.key)) slides.set(m.key, newSlide(m.from, at, plan.timing ?? { ms: SLIDE_MS * devScale(), easing: SLIDE_EASING }));
    ghosts.current = [...ghosts.current, ...plan.ghosts];
    clipped.clear();
    for (const key of plan.clipped) clipped.add(key);
    queued.current = plan;
  };

  const before = from.pending;
  if (before) {
    from.pending = null;
    const plan = enabled ? planner(before, { state: workspaceSnapshot(), list: entries, live: live(), heights: liveHeightsNow() }, slides, ghosts.current, Date.now()) : null;
    if (plan) prepare(plan, Date.now());
  }
  if (entries !== seen.current) {
    seen.current = entries;
    const present = new Set(entries);
    for (const key of slides.keys()) if (key !== TAIL && !present.has(key)) slides.delete(key);
    for (const key of contexts.keys()) if (!present.has(key)) contexts.delete(key);
    for (const key of clipped) if (key !== TAIL && !present.has(key)) clipped.delete(key);
  }

  const slideBelow = useRef((entry: string, delta: number, fold?: FoldSlideOptions): Animated.Value | null => {
    const list = latest.current;
    const i = list.indexOf(entry);
    if (i < 0) return null;
    const t = Date.now();
    const keys = [...list.slice(i + 1), ...(!fold || fold.tail ? [TAIL] : [])];
    if (!keys.length) return null;
    prepare({ moves: keys.map((key) => ({ key, from: shiftAt(slides.get(key), t) + delta })), ghosts: [], clipped: fold ? [] : [list[i + 1] ?? TAIL], below: 0, ...(fold ? { timing: fold.timing } : {}) }, t);
    rerender((n) => n + 1);
    return slides.get(keys[0]!)?.value ?? null;
  }).current;

  useLayoutEffect(() => {
    const plan = queued.current;
    if (!plan) return;
    queued.current = null;
    const at = Date.now();
    const slideMs = plan.timing?.ms ?? SLIDE_MS * devScale();
    const easing = plan.timing?.easing ?? SLIDE_EASING;
    const token = plan.clipped.length ? {} : null;
    clipping.current = token;
    for (const [i, m] of plan.moves.entries()) {
      const slide = slides.get(m.key);
      if (!slide) continue;
      restart(slide, m.from);
      slide.from = m.from;
      slide.at = at;
      slide.until = at + slideMs + FRAME_SLACK_MS;
      slide.landed = false;
      slide.ms = slideMs;
      slide.easing = easing;
      const timing = Animated.timing(slide.value, { toValue: 0, duration: slideMs, easing, useNativeDriver: native });
      const clips = i === 0 && token;
      slide.live = true;
      timing.start(({ finished }) => {
        if (slide.at === at) slide.live = false;
        if (!finished) return;
        slide.landed = true;
        if (native && slide.at === at) slide.value.setValue(0);
        if (!clips) return;
        queueMicrotask(() => {
          if (clipping.current !== token) return;
          clipping.current = null;
          clipped.clear();
          announce();
        });
      });
    }
    for (const g of plan.ghosts) {
      g.until = at + FADE_MS * devScale() + FRAME_SLACK_MS;
      Animated.timing(g.opacity, { toValue: 0, duration: FADE_MS * devScale(), easing: FADE_EASING, useNativeDriver: true }).start();
    }
    announce();
    if (plan.below) below?.(plan.below);
  });

  const motion = (entry: string): EntryMotion | null => {
    const shift = slides.get(entry)?.value ?? null;
    const known = contexts.get(entry);
    if (!shift && !known && !clipped.has(entry)) return null;
    if (known && known.shift === shift) return known;
    const next = { shift, clip: source(entry) };
    contexts.set(entry, next);
    return next;
  };

  const slots = (list: string[]): ListSlot[] => {
    if (!ghosts.current.length) return list.map((entry) => ({ entry }));
    const place = (ghost: Ghost, top: number): ListSlot => ({ ghost, top });
    const byAnchor = new Map<string | null, Ghost[]>();
    for (const g of ghosts.current) byAnchor.set(g.anchor, [...(byAnchor.get(g.anchor) ?? []), g]);
    const out: ListSlot[] = [];
    let y = 0;
    let shown = 0;
    for (const entry of entries) {
      const here = byAnchor.get(entry);
      const mounted = shown < list.length && list[shown] === entry;
      if (here && mounted) for (const ghost of here) out.push(place(ghost, ghost.y - y));
      if (mounted) {
        out.push({ entry });
        shown++;
      }
      if (here) byAnchor.delete(entry);
      y += height(entry) + GAP;
    }
    for (const left of byAnchor.values()) for (const ghost of left) if (!ghost.anchor || !entries.includes(ghost.anchor)) out.push(place(ghost, ghost.y - y));
    return out;
  };

  return { motion, slots, fading: ghosts.current.length > 0, slideBelow, tail: slides.get(TAIL)?.value ?? null, tailClip: source(TAIL) };
}

export function useListMotion(windowId: string, profileId: string, entries: string[], from: Capture, enabled: boolean) {
  const height: Height = (s, e) => entryHeight(s, windowId, profileId, e);
  const planner: Planner = (before, after, slides, ghosts, t) => {
    const was: Height = (s, e) => entryHeight(s, windowId, profileId, e, basisOf(before));
    const is: Height = (s, e) => entryHeight(s, windowId, profileId, e, basisOf(after));
    const changes = new Map<string, GroupChange>();
    if (before.state.groups !== after.state.groups) {
      const had = new Set(before.list);
      for (const e of after.list) {
        const groupId = entryId(e, "group");
        if (!had.has(e) || groupId === null) continue;
        const change = groupChange(before.state, after.state, windowId, profileId, groupId);
        if (change === "other" && was(before.state, e) !== is(after.state, e)) return null;
        if (change === "grown" || change === "extended") changes.set(e, change);
      }
    }
    const start = changes.size ? 0 : sharedPrefix(before.list, after.list);
    const had = new Set(before.list.slice(start));
    const kept = new Set(after.list.slice(start));
    const removed = before.list.slice(start).filter((e) => !kept.has(e));
    const added = after.list.slice(start).filter((e) => !had.has(e));
    const moved = movedBy(before, after, windowId, profileId);
    if (!removed.length && !added.length && !changes.size && !moved) return null;
    if (!removed.every(closedIn(before, after, windowId, profileId)) || !added.every(openedIn(before, after, windowId, profileId))) return null;
    const grown = [...changes].flatMap(([e, c]) => (c === "grown" ? [e] : []));
    if (!removed.length && !added.length && !grown.length && !moved) return null;
    const now: Height = (s, e) => (changes.get(e) === "extended" ? was(before.state, e) : is(s, e));
    const base = prefixHeight(after.state, after.list, start, now);
    const old = offsets(before.state, before.list, was, start, base);
    const next = offsets(after.state, after.list, now, start, base);
    const snapshot = (e: string) => snapshotEntry(before.state, windowId, profileId, e, before.live);
    return buildPlan({ before, after, old, next, removed, added, slides, ghosts, t, tail: true, snapshot, clipAfter: grown, start, still: moved });
  };
  return useMotion({ devKey: `${windowId}:${profileId}:today`, entries, from, planner, height: (e) => height(workspaceSnapshot(), e), enabled, native: true });
}

export function usePinnedMotion(windowId: string, profileId: string, entries: string[], from: Capture, enabled: boolean, boundary: Boundary) {
  const liftIn = (s: BrowserState, list: string[], i: number) => rootLift(addressBarInSidebar(s, windowId), list[i - 1], list[i]!);
  const rootOffsets = (snap: Snapshot, base: number): Offsets => {
    const at = new Map<string, number>();
    let y = base;
    snap.list.forEach((e, i) => {
      const lift = liftIn(snap.state, snap.list, i);
      at.set(e, y + lift);
      y += lift + entryHeight(snap.state, windowId, profileId, e, basisOf(snap)) + GAP;
    });
    return { at, end: snap.list.length ? y - GAP : base };
  };
  const planner: Planner = (before, after, slides, ghosts, t) => {
    const had = new Set(before.list);
    const kept = new Set(after.list);
    const removed = before.list.filter((e) => !kept.has(e));
    const added = after.list.filter((e) => !had.has(e));
    const moved = movedBy(before, after, windowId, profileId);
    if (!moved && !removed.length === !added.length) return null;
    if (!removed.every(closedIn(before, after, windowId, profileId)) || !added.every(openedIn(before, after, windowId, profileId))) return null;
    const was = boundary(before.list);
    const is = boundary(after.list);
    const old = rootOffsets(before, was.above - is.above);
    old.end += was.below - is.below;
    const next = rootOffsets(after, 0);
    const snapshot = (e: string) => snapshotEntry(before.state, windowId, profileId, e, before.live);
    return buildPlan({ before, after, old, next, removed, added, slides, ghosts, t, tail: true, snapshot, clipAfter: [], start: 0, still: moved });
  };
  const height = (e: string) => {
    const s = workspaceSnapshot();
    const i = entries.indexOf(e);
    return (i < 0 ? 0 : liftIn(s, entries, i)) + entryHeight(s, windowId, profileId, e);
  };
  return useMotion({ devKey: `${windowId}:${profileId}:pinned`, entries, from, planner, height, enabled, native: true });
}

export function useGroupMotion(windowId: string, profileId: string, groupId: string, entries: string[], from: Capture, scope: ListMotionScope, enabled: boolean) {
  const height: Height = (s, e) => entryHeight(s, windowId, profileId, e);
  const planner: Planner = (before, after, slides, ghosts, t) => {
    const was = before.state.groups[groupId];
    const now = after.state.groups[groupId];
    if (!was || !now || was.collapsed || now.collapsed) return null;
    const had = new Set(before.list);
    const kept = new Set(after.list);
    const removed = before.list.filter((e) => !kept.has(e));
    const added = after.list.filter((e) => !had.has(e));
    const moved = movedBy(before, after, windowId, profileId);
    if (!moved && !removed.length === !added.length) return null;
    if (!removed.every(closedIn(before, after, windowId, profileId)) || !added.every(openedIn(before, after, windowId, profileId))) return null;
    const old = offsets(before.state, before.list, (s, e) => entryHeight(s, windowId, profileId, e, basisOf(before)));
    const next = offsets(after.state, after.list, (s, e) => entryHeight(s, windowId, profileId, e, basisOf(after)));
    const snapshot = (e: string) => snapshotEntry(before.state, windowId, profileId, e, before.live);
    const atEnd = !removed.length && groupGrowsAtEnd(before.state, after.state, windowId, profileId, groupId);
    const plan = buildPlan({ before, after, old, next, removed, added, slides, ghosts, t, tail: !atEnd, snapshot, clipAfter: [], start: 0, still: moved });
    if (!atEnd) return plan;
    return { ...(plan ?? { moves: [], ghosts: [], clipped: [] }), below: old.end - next.end };
  };
  const below = scope.slideBelow ? (delta: number) => scope.slideBelow?.(entryKey("group", groupId), delta) : null;
  return useMotion({ devKey: `${windowId}:${groupId}`, entries, from, planner, height: (e) => height(workspaceSnapshot(), e), enabled, native: false, below });
}

export const GhostSlot = memo(function GhostSlot({ snapshot, top, opacity }: { snapshot: EntrySnapshot; top: number; opacity: Animated.Value }) {
  const style = useMemo(() => ({ opacity }), [opacity]);
  const [fade, ref] = useAnimatedStyle(style);
  const theme = useTheme();
  const label = useArcLabel() ?? theme.textTab;
  return (
    <View pointerEvents="none" {...fade} ref={ref} style={[{ height: 0, marginBottom: -GAP }, fade.style as object]}>
      <Surface hidesAccessibility style={{ position: "absolute", left: 0, right: 0, top: 0 }}>
        {ghostEntry(snapshot, theme, top, label)}
      </Surface>
    </View>
  );
});


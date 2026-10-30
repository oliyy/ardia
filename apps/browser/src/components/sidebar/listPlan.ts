import { Animated } from "react-native";
import { layout } from "../ui/theme";
import type { BrowserState } from "../../state/browser/store";
import { parseEntry } from "../../state/sidebar/entryKey";
import { splitTabIdsOf } from "../../state/splits/splits";
import type { HeightBasis } from "../../state/sidebar/geometry";
import type { ListSnapshot } from "../../state/sidebar/listCapture";
import { folderChildren, folderChildrenWith } from "../../state/sidebar/pinnedTree";
import type { EntrySnapshot } from "./ghostShots";

const GAP = layout.rowGap;
export const TAIL = "~tail";

export type SlideTiming = { ms: number; easing: (t: number) => number };
export type FoldSlideOptions = { timing: SlideTiming; tail: boolean };
export type Slide = { value: Animated.Value; from: number; at: number; until: number; landed: boolean; live: boolean; superseded: number; ms: number; easing: (t: number) => number };
type SyncedValue = { __onAnimatedValueUpdateReceived: (value: number, offset?: number) => void };

export function newSlide(from: number, at: number, timing: SlideTiming): Slide {
  const slide: Slide = { value: new Animated.Value(from), from, at, until: 0, landed: false, live: false, superseded: 0, ms: timing.ms, easing: timing.easing };
  const value = slide.value as unknown as SyncedValue;
  const receive = value.__onAnimatedValueUpdateReceived.bind(value);
  value.__onAnimatedValueUpdateReceived = (next, offset) => {
    if (slide.superseded > 0) return void (slide.superseded -= 1);
    receive(next, offset);
  };
  return slide;
}
export type Ghost = { key: string; anchor: string | null; y: number; snapshot: EntrySnapshot; opacity: Animated.Value; until: number };
export type Snapshot = ListSnapshot;
export type Move = { key: string; from: number };
export type Plan = { moves: Move[]; ghosts: Ghost[]; clipped: string[]; below: number; timing?: SlideTiming };
export type Offsets = { at: Map<string, number>; end: number };
export type Height = (s: BrowserState, entry: string) => number;
export type Planner = (before: Snapshot, after: Snapshot, slides: Map<string, Slide>, ghosts: Ghost[], t: number) => Plan | null;
export type ListSlot = { entry: string } | { ghost: Ghost; top: number };
export const basisOf = (snap: Snapshot): HeightBasis => ({ folders: snap.live.folders, heights: snap.heights });

let ghostIds = 0;

type Subtree = { tabs: string[]; groups: string[]; lives: string[] };

function subtreeOf(snap: Snapshot, windowId: string, profileId: string, entry: string, into: Subtree = { tabs: [], groups: [], lives: [] }): Subtree {
  const { kind, id } = parseEntry(entry);
  if (kind === "live") into.lives.push(id);
  else if (kind === "split") into.tabs.push(...(splitTabIdsOf(snap.state.splits[id]) ?? []));
  else if (kind !== "group") into.tabs.push(id);
  else if (!into.groups.includes(id)) {
    into.groups.push(id);
    if (snap.state.groups[id]) for (const child of folderChildrenWith(snap.state, windowId, profileId, id, snap.live.folders)) subtreeOf(snap, windowId, profileId, child, into);
  }
  return into;
}

const goneFrom = (from: Snapshot, to: Snapshot, windowId: string, profileId: string) => (entry: string) => {
  const { tabs, groups, lives } = subtreeOf(from, windowId, profileId, entry);
  if (!tabs.length && !groups.length && !lives.length) return false;
  return tabs.every((id) => !to.state.tabs[id]) && groups.every((id) => !to.state.groups[id]) && lives.every((id) => !to.live.folders[id]);
};

export const closedIn = (before: Snapshot, after: Snapshot, windowId: string, profileId: string) => goneFrom(before, after, windowId, profileId);
export const openedIn = (before: Snapshot, after: Snapshot, windowId: string, profileId: string) => goneFrom(after, before, windowId, profileId);

export function offsets(s: BrowserState, entries: string[], height: Height, start = 0, base = 0): Offsets {
  const at = new Map<string, number>();
  let y = base;
  for (let i = start; i < entries.length; i++) {
    at.set(entries[i]!, y);
    y += height(s, entries[i]!) + GAP;
  }
  return { at, end: y };
}

export function sharedPrefix(a: string[], b: string[]): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

export function prefixHeight(s: BrowserState, entries: string[], count: number, height: Height): number {
  let y = 0;
  for (let i = 0; i < count; i++) y += height(s, entries[i]!) + GAP;
  return y;
}

export function shiftAt(slide: Slide | undefined, t: number): number {
  if (!slide) return 0;
  const p = Math.min(1, Math.max(0, (t - slide.at) / slide.ms));
  return slide.from * (1 - slide.easing(p));
}

export type Diff = {
  before: Snapshot;
  after: Snapshot;
  old: Offsets;
  next: Offsets;
  removed: string[];
  added: string[];
  slides: Map<string, Slide>;
  ghosts: Ghost[];
  t: number;
  tail: boolean;
  snapshot: (entry: string) => EntrySnapshot | null;
  clipAfter: string[];
  start: number;
  still: string | null;
};

export function buildPlan({ before, after, old, next, removed, added, slides, ghosts, t, tail, snapshot, clipAfter, start, still }: Diff): Plan | null {
  const kept = new Set(after.list.slice(start));
  const had = new Set(before.list.slice(start));
  const moves: Move[] = [];
  for (let i = start; i < after.list.length; i++) {
    const e = after.list[i]!;
    if (e === still || !had.has(e) || !next.at.has(e)) continue;
    const delta = old.at.get(e)! - next.at.get(e)!;
    if (delta) moves.push({ key: e, from: shiftAt(slides.get(e), t) + delta });
  }
  if (tail && old.end !== next.end) moves.push({ key: TAIL, from: shiftAt(slides.get(TAIL), t) + old.end - next.end });
  const anchorAfter = (entry: string): string | null => {
    for (let i = before.list.indexOf(entry, start) + 1; i < before.list.length; i++) if (kept.has(before.list[i]!)) return before.list[i]!;
    return null;
  };
  const gone = new Set(removed);
  for (const g of ghosts) if (g.anchor && gone.has(g.anchor)) g.anchor = anchorAfter(g.anchor);
  const born = removed.flatMap((e): Ghost[] => {
    const shot = snapshot(e);
    if (!shot) return [];
    const y = old.at.get(e)! + shiftAt(slides.get(e), t);
    return [{ key: `ghost:${++ghostIds}`, anchor: anchorAfter(e), y, snapshot: shot, opacity: new Animated.Value(1), until: 0 }];
  });
  if (!moves.length) return born.length ? { moves, ghosts: born, clipped: [], below: 0 } : null;
  const fresh = new Set(added);
  const clipped = [...added, ...clipAfter].flatMap((e) => {
    const following = after.list[after.list.indexOf(e) + 1];
    return following === undefined ? (tail ? [TAIL] : []) : fresh.has(following) ? [] : [following];
  });
  return { moves, ghosts: born, clipped, below: 0 };
}

export type GroupChange = "same" | "grown" | "extended" | "other";

export function groupGrowsAtEnd(before: BrowserState, after: BrowserState, windowId: string, profileId: string, groupId: string): boolean {
  const last = folderChildren(after, windowId, profileId, groupId).at(-1);
  return !!last && !folderChildren(before, windowId, profileId, groupId).includes(last);
}

export function groupChange(before: BrowserState, after: BrowserState, windowId: string, profileId: string, groupId: string): GroupChange {
  const was = before.groups[groupId];
  const now = after.groups[groupId];
  if (!was || !now) return "other";
  const had = new Set(was.tabIds);
  const has = new Set(now.tabIds);
  const gone = was.tabIds.filter((id) => !has.has(id));
  const came = now.tabIds.filter((id) => !had.has(id));
  if (!gone.length && !came.length) return "same";
  const expanded = !was.collapsed && !now.collapsed;
  if (expanded && !came.length && gone.every((id) => !after.tabs[id])) return "extended";
  if (!expanded || gone.length || !came.every((id) => !before.tabs[id])) return "other";
  return groupGrowsAtEnd(before, after, windowId, profileId, groupId) ? "grown" : "extended";
}

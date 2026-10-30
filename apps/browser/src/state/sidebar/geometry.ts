import { SIDEBAR_GROUP, SIDEBAR_ROW } from "../../lib/sidebarMetrics";
import { useBrowser, type BrowserState } from "../browser/store";
import { live } from "../live/store";
import { ancestorIds } from "../groups/groups";
import { groupOf } from "../pins/tabGrouping";
import { splitOf, splitTabIdsOf } from "../splits/splits";
import { pinSection } from "../browser/model";
import { addressBarInSidebar } from "../windows/layout";
import { sidebarEntries } from "./entries";
import { entryId, entryKey, parseEntry } from "./entryKey";
import { activePath, containersOf, folderChildren, folderChildrenWith, liveHeight, pinnedRoot, type ActivePath, type LiveDefs, type LiveHeights } from "./pinnedTree";

export const FOLD_MS = 150;
const ROW = SIDEBAR_ROW.height;
const GAP = SIDEBAR_ROW.gap;

export type GroupFrame = { border: number; padTop: number; padBottom: number };
const BOXED_GROUP: GroupFrame = { border: SIDEBAR_GROUP.border, padTop: 0, padBottom: SIDEBAR_GROUP.pad };
const FLAT_GROUP: GroupFrame = { border: 0, padTop: GAP, padBottom: 0 };

export const groupFrame = (flat: boolean): GroupFrame => (flat ? FLAT_GROUP : BOXED_GROUP);

export const headGap = (first: string | null | undefined): number => (first && entryId(first, "group") !== null ? GAP : 0);

export const padTopOf = (frame: GroupFrame, first: string | null | undefined): number => (frame === BOXED_GROUP ? headGap(first) : frame.padTop);

const DIA_LIVE_GAP = 7;
const DIA_LIVE_LIFT = DIA_LIVE_GAP - GAP;
const isLive = (entry: string | undefined) => !!entry && entryId(entry, "live") !== null;

export const rootLift = (flat: boolean, prev: string | undefined, entry: string): number => (!flat && prev !== undefined && isLive(prev) !== isLive(entry) ? DIA_LIVE_LIFT : 0);

export const rootTrail = (flat: boolean, entries: string[]): number => (!flat && isLive(entries.at(-1)) && entries.some((e) => !isLive(e)) ? DIA_LIVE_GAP : 0);

export type Section = "pinned" | "list";

function onPath(s: BrowserState, path: ActivePath, entry: string): boolean {
  if (!path.tab) return false;
  const { kind, id } = parseEntry(entry);
  if (kind === "group") return path.groups.includes(id) || !!s.groups[id]?.tabIds.includes(path.tab);
  if (kind === "live") return path.live === id;
  if (kind === "split") return !!splitTabIdsOf(s.splits[id])?.includes(path.tab);
  return id === path.tab;
}

export function keptEntry(s: BrowserState, windowId: string, profileId: string, entries: string[]): string | null {
  const path = activePath(s, windowId, profileId);
  if (!path.tab) return null;
  return entries.find((e) => onPath(s, path, e)) ?? null;
}

export type HeightBasis = { folders: LiveDefs; heights: LiveHeights } | null;

function folderHeight(s: BrowserState, windowId: string, profileId: string, groupId: string, frame: GroupFrame, peek: boolean, basis: HeightBasis): number | null {
  const entries = basis ? folderChildrenWith(s, windowId, profileId, groupId, basis.folders) : folderChildren(s, windowId, profileId, groupId);
  const header = frame.border * 2 + ROW;
  if (s.groups[groupId]?.collapsed || peek) {
    const kept = keptEntry(s, windowId, profileId, entries);
    if (!kept) return header;
    const inner = spanHeight(s, windowId, profileId, kept, frame, true, basis);
    return inner === null ? null : header + padTopOf(frame, kept) + inner + frame.padBottom;
  }
  if (!entries.length) return header + frame.padBottom;
  let sum = header + padTopOf(frame, entries[0]) + frame.padBottom + (entries.length - 1) * GAP;
  for (const e of entries) {
    const h = spanHeight(s, windowId, profileId, e, frame, false, basis);
    if (h === null) return null;
    sum += h;
  }
  return sum;
}

function spanHeight(s: BrowserState, windowId: string, profileId: string, entry: string, frame: GroupFrame, peek: boolean, basis: HeightBasis = null): number | null {
  const { kind, id } = parseEntry(entry);
  if (kind === "group") return folderHeight(s, windowId, profileId, id, frame, peek, basis);
  if (kind === "live") return liveHeight(windowId, profileId, id, basis?.heights);
  return ROW;
}

export function entryHeight(s: BrowserState, windowId: string, profileId: string, entry: string, basis: HeightBasis = null): number {
  return spanHeight(s, windowId, profileId, entry, groupFrame(addressBarInSidebar(s, windowId)), false, basis) ?? ROW;
}

export function entriesHeight(s: BrowserState, windowId: string, profileId: string, entries: string[]): number {
  return entries.reduce((sum, e) => sum + entryHeight(s, windowId, profileId, e) + GAP, 0) - (entries.length ? GAP : 0);
}

export function entriesWithin(s: BrowserState, windowId: string, profileId: string, entries: string[], height: number): number {
  let top = 0;
  let n = 0;
  while (n < entries.length && top < height) top += entryHeight(s, windowId, profileId, entries[n++]!) + GAP;
  return n;
}

const EAGER_FIRST_PAINT_ENTRIES = 64;
export const FIRST_PAINT_HEIGHT = 2400;

export function firstPaintEntries(s: BrowserState, windowId: string, profileId: string, entries: string[], lazy: boolean): number {
  if (!lazy) return EAGER_FIRST_PAINT_ENTRIES;
  return Math.max(1, entriesWithin(s, windowId, profileId, entries, s.windows[windowId]?.frame?.[3] ?? FIRST_PAINT_HEIGHT));
}

export const startsOffScreen = (lazy: boolean, current: boolean) => lazy && !current;

function shownRoot(s: BrowserState, windowId: string, profileId: string): string[] {
  const root = pinnedRoot(s, windowId, profileId);
  if (!s.profiles[profileId]?.pinnedCollapsed) return root;
  const kept = keptEntry(s, windowId, profileId, root);
  return kept ? [kept] : [];
}

type Span = { top: number; height: number };
type Found = Span | "unknown" | null;

export function rowSpan(s: BrowserState, windowId: string, profileId: string, id: string, newTabAtTop: boolean): { section: Section; top: number; height: number } | null {
  const tab = s.tabs[id];
  const target = tab ? ({ kind: "tab", id } as const) : s.groups[id] ? ({ kind: "group", id } as const) : null;
  if (!target) return null;
  const flat = addressBarInSidebar(s, windowId);
  const frame = groupFrame(flat);
  const containers = new Set(containersOf(s, windowId, profileId, target));
  const liveOf = tab?.liveItem && !tab.pin ? tab.liveItem.folderId : null;
  const own = (e: string) => {
    if (target.kind === "group") return e === entryKey("group", id);
    const split = entryId(e, "split");
    return e === entryKey("tab", id) || (split !== null && !!splitTabIdsOf(s.splits[split])?.includes(id));
  };
  const holds = (e: string) => {
    const { kind, id: entry } = parseEntry(e);
    return (kind === "group" && containers.has(entry)) || (kind === "live" && entry === liveOf);
  };

  const inFolder = (groupId: string, top: number, peek: boolean): Found => {
    const header = top + frame.border;
    const entries = folderChildren(s, windowId, profileId, groupId);
    if (!s.groups[groupId]?.collapsed && !peek) return inList(entries, header + ROW + padTopOf(frame, entries[0])) ?? "unknown";
    const kept = keptEntry(s, windowId, profileId, entries);
    if (!kept || !(own(kept) || holds(kept))) return { top: header, height: ROW };
    const start = header + ROW + padTopOf(frame, kept);
    if (own(kept)) return { top: start, height: ROW };
    const keptGroup = entryId(kept, "group");
    return keptGroup !== null ? inFolder(keptGroup, start, true) : "unknown";
  };

  const inList = (entries: string[], top: number, root = false): Found => {
    let y: number | null = top;
    for (const [i, e] of entries.entries()) {
      if (root && y !== null) y += rootLift(flat, entries[i - 1], e);
      if (own(e) || holds(e)) {
        if (y === null) return "unknown";
        if (own(e)) return { top: y, height: ROW };
        const group = entryId(e, "group");
        return group !== null ? inFolder(group, y, false) : "unknown";
      }
      const h: number | null = y === null ? null : spanHeight(s, windowId, profileId, e, frame, false);
      y = y === null || h === null ? null : y + h + GAP;
    }
    return null;
  };

  const sections: [Section, string[], number, boolean][] = [
    ["pinned", shownRoot(s, windowId, profileId), 0, true],
    ["list", sidebarEntries(s, windowId, profileId).list, newTabAtTop ? ROW + GAP : 0, false],
  ];
  for (const [section, entries, start, root] of sections) {
    const found = inList(entries, start, root);
    if (found === "unknown") return null;
    if (found) return { section, ...found };
  }
  return null;
}

export const entryHeightNow = (windowId: string, profileId: string, entry: string): number => entryHeight(useBrowser.getState(), windowId, profileId, entry);

export const firstPaintEntriesNow = (windowId: string, profileId: string, entries: string[], lazy: boolean): number =>
  firstPaintEntries(useBrowser.getState(), windowId, profileId, entries, lazy);

export function foldedGroupHeight(windowId: string, profileId: string, groupId: string): number {
  const s = useBrowser.getState();
  const frame = groupFrame(addressBarInSidebar(s, windowId));
  return folderHeight(s, windowId, profileId, groupId, frame, true, null) ?? frame.border * 2 + ROW;
}

export function groupFoldDelta(windowId: string, profileId: string, groupId: string): number | null {
  const s = useBrowser.getState();
  const group = s.groups[groupId];
  if (!group) return null;
  const height = (collapsed: boolean) => entryHeight({ ...s, groups: { ...s.groups, [groupId]: { ...group, collapsed } } }, windowId, profileId, entryKey("group", groupId));
  return height(false) - height(true);
}

export const keptEntryNow = (windowId: string, profileId: string, entries: string[]): string | null => keptEntry(useBrowser.getState(), windowId, profileId, entries);

export const usePendingEntriesHeight = (windowId: string, profileId: string, entries: string[], from: number, growing: boolean): number =>
  useBrowser((s) => (growing ? entriesHeight(s, windowId, profileId, entries.slice(from)) : 0));

export type RevealSpot = { span: { section: Section; top: number; height: number } } | { keys: string[] } | null;

export function revealSpot(windowId: string, tabId: string, tilesFixed: boolean, newTabAtTop: boolean): RevealSpot {
  const s = useBrowser.getState();
  const profileId = s.windows[windowId]?.profileId;
  if (!profileId) return null;
  if (tilesFixed && pinSection(s.tabs[tabId]) === "tile") return null;
  const span = rowSpan(s, windowId, profileId, tabId, newTabAtTop);
  const pinnedHasLive = span?.section === "pinned" && live().folderOrder.some((id) => live().folders[id]?.profileId === profileId);
  const pinnedFolded = span?.section === "pinned" && !!s.profiles[profileId]?.pinnedCollapsed;
  if (span && !pinnedHasLive && !pinnedFolded) return { span };
  const split = splitOf(s, tabId);
  const inner = groupOf(s, tabId);
  return { keys: [tabId, ...(split ? [entryKey("split", split.id)] : []), ...(inner ? [inner.id, ...ancestorIds(s.groups, inner.id)] : [])] };
}

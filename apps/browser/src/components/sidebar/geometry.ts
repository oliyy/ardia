import { layout } from "../../lib/theme";
import type { BrowserState } from "../../store/browser";
import { addressBarInSidebar } from "../layout/windowLayout";
import { sidebarEntries } from "./entries";
import { activePath, containersOf, folderChildren, folderChildrenWith, liveHeight, pinnedRoot, type ActivePath, type LiveDefs, type LiveHeights } from "./pinnedTree";

export const FOLD_MS = 150;
export const GROUP_PAD = 2;
export const GROUP_INDENT = 16;
export const GROUP_BORDER = 0.5;
export const GROUP_RADIUS = 12;
export const GROUP_HEADER_RADIUS = GROUP_RADIUS - GROUP_BORDER;
const ROW = layout.rowHeight;
const GAP = layout.rowGap;
export const ARC_FOLDER_INDENT = 16;

type GroupFrame = { border: number; padTop: number; padBottom: number };
const BOXED_GROUP: GroupFrame = { border: GROUP_BORDER, padTop: 0, padBottom: GROUP_PAD };
const FLAT_GROUP: GroupFrame = { border: 0, padTop: GAP, padBottom: 0 };

export const groupFrame = (flat: boolean): GroupFrame => (flat ? FLAT_GROUP : BOXED_GROUP);

const DIA_LIVE_GAP = 7;
const DIA_LIVE_LIFT = DIA_LIVE_GAP - GAP;
const isLive = (entry: string | undefined) => !!entry?.startsWith("l:");

export const rootLift = (flat: boolean, prev: string | undefined, entry: string): number => (!flat && prev !== undefined && isLive(prev) !== isLive(entry) ? DIA_LIVE_LIFT : 0);

export const rootTrail = (flat: boolean, entries: string[]): number => (!flat && isLive(entries.at(-1)) && entries.some((e) => !isLive(e)) ? DIA_LIVE_GAP : 0);

export type Section = "pinned" | "list";

const onPath = (s: BrowserState, path: ActivePath, entry: string): boolean => {
  const id = entry.slice(2);
  if (!path.tab) return false;
  if (entry.startsWith("g:")) return path.groups.includes(id) || !!s.groups[id]?.tabIds.includes(path.tab);
  if (entry.startsWith("l:")) return path.live === id;
  if (entry.startsWith("s:")) return !!s.splits[id]?.tabIds.includes(path.tab);
  return id === path.tab;
};

export function holdsTab(s: BrowserState, entry: string, tabId: string): boolean {
  const id = entry.slice(2);
  if (entry.startsWith("g:")) return !!s.groups[id]?.tabIds.includes(tabId);
  if (entry.startsWith("s:")) return !!s.splits[id]?.tabIds.includes(tabId);
  return id === tabId;
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
    return inner === null ? null : header + frame.padTop + inner + frame.padBottom;
  }
  if (!entries.length) return header + frame.padBottom;
  let sum = header + frame.padTop + frame.padBottom + (entries.length - 1) * GAP;
  for (const e of entries) {
    const h = spanHeight(s, windowId, profileId, e, frame, false, basis);
    if (h === null) return null;
    sum += h;
  }
  return sum;
}

function spanHeight(s: BrowserState, windowId: string, profileId: string, entry: string, frame: GroupFrame, peek: boolean, basis: HeightBasis = null): number | null {
  if (entry.startsWith("g:")) return folderHeight(s, windowId, profileId, entry.slice(2), frame, peek, basis);
  if (entry.startsWith("l:")) return liveHeight(windowId, profileId, entry.slice(2), basis?.heights);
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

type Span = { top: number; height: number };
type Found = Span | "unknown" | null;

export function rowSpan(s: BrowserState, windowId: string, profileId: string, id: string, newTabAtTop: boolean): { section: Section; top: number; height: number } | null {
  const tab = s.tabs[id];
  const target = tab ? ({ kind: "tab", id } as const) : s.groups[id] ? ({ kind: "group", id } as const) : null;
  if (!target) return null;
  const flat = addressBarInSidebar(s, windowId);
  const frame = groupFrame(flat);
  const containers = new Set(containersOf(s, windowId, profileId, target));
  const liveOf = tab?.liveItem && !tab.pinned ? tab.liveItem.folderId : null;
  const own = (e: string) => (target.kind === "group" ? e === `g:${id}` : e === `t:${id}` || (e.startsWith("s:") && !!s.splits[e.slice(2)]?.tabIds.includes(id)));
  const holds = (e: string) => (e.startsWith("g:") && containers.has(e.slice(2))) || (e.startsWith("l:") && e.slice(2) === liveOf);

  const inFolder = (groupId: string, top: number, peek: boolean): Found => {
    const header = top + frame.border;
    const entries = folderChildren(s, windowId, profileId, groupId);
    const start = header + ROW + frame.padTop;
    if (!s.groups[groupId]?.collapsed && !peek) return inList(entries, start) ?? "unknown";
    const kept = keptEntry(s, windowId, profileId, entries);
    if (!kept || !(own(kept) || holds(kept))) return { top: header, height: ROW };
    if (own(kept)) return { top: start, height: ROW };
    return kept.startsWith("g:") ? inFolder(kept.slice(2), start, true) : "unknown";
  };

  const inList = (entries: string[], top: number, root = false): Found => {
    let y: number | null = top;
    for (const [i, e] of entries.entries()) {
      if (root && y !== null) y += rootLift(flat, entries[i - 1], e);
      if (own(e) || holds(e)) {
        if (y === null) return "unknown";
        if (own(e)) return { top: y, height: ROW };
        return e.startsWith("g:") ? inFolder(e.slice(2), y, false) : "unknown";
      }
      const h: number | null = y === null ? null : spanHeight(s, windowId, profileId, e, frame, false);
      y = y === null || h === null ? null : y + h + GAP;
    }
    return null;
  };

  const sections: [Section, string[], number, boolean][] = [
    ["pinned", pinnedRoot(s, windowId, profileId), 0, true],
    ["list", sidebarEntries(s, windowId, profileId).list, newTabAtTop ? ROW + GAP : 0, false],
  ];
  for (const [section, entries, start, root] of sections) {
    const found = inList(entries, start, root);
    if (found === "unknown") return null;
    if (found) return { section, ...found };
  }
  return null;
}

import { live, useLive } from "../../live/store";
import type { LiveFolder } from "../../live/types";
import { useBrowser, type BrowserState } from "../../store/browser";
import { activeTabId } from "../../store/model";
import { groupOf } from "../../store/organize";
import { ancestorsOf, groupNode, isLiveNode, keyOfNode, liveNode, pinKeyOf, tableOf, tabNode } from "../../store/pinTree";
import { stableList } from "../../store/structure";
import { folderPath, groupEntries, sidebarEntries, windowHierarchy } from "./entries";

export type LiveDefs = Record<string, LiveFolder>;
type LiveState = ReturnType<typeof live>;

function keepRemoved<T>(next: Record<string, T>, prev: Record<string, T>, gone: string[]): Record<string, T> {
  let out = next;
  for (const id of gone) {
    if (prev[id] === undefined || out[id] !== undefined) continue;
    if (out === next) out = { ...next };
    out[id] = prev[id]!;
  }
  return out;
}

function withRemoved(prev: LiveState, next: LiveState): LiveState {
  const gone = Object.keys(prev.folders).filter((id) => !next.folders[id]);
  if (!gone.length) return next;
  return {
    ...next,
    folders: keepRemoved(next.folders, prev.folders, gone),
    items: keepRemoved(next.items, prev.items, gone),
    unread: keepRemoved(next.unread, prev.unread, gone),
    completed: keepRemoved(next.completed, prev.completed, gone),
    completing: keepRemoved(next.completing, prev.completing, gone),
    completions: keepRemoved(next.completions, prev.completions, gone),
    status: keepRemoved(next.status, prev.status, gone),
  };
}

let latestLive: LiveState = live();
useLive.subscribe((next) => {
  latestLive = withRemoved(latestLive, next);
});

function pickFolders<T>(latest: Record<string, T>, base: Record<string, T>, ids: string[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const id of ids) {
    const value = latest[id] ?? base[id];
    if (value !== undefined) out[id] = value;
  }
  return out;
}

export function liveAsOf(base: LiveState): LiveState {
  const latest = latestLive;
  const ids = Object.keys(base.folders);
  return {
    ...latest,
    folders: pickFolders(latest.folders, base.folders, ids),
    items: pickFolders(latest.items, base.items, ids),
    unread: pickFolders(latest.unread, base.unread, ids),
    completed: pickFolders(latest.completed, base.completed, ids),
    completing: pickFolders(latest.completing, base.completing, ids),
    completions: pickFolders(latest.completions, base.completions, ids),
    status: pickFolders(latest.status, base.status, ids),
  };
}
type Shown = { folders: LiveDefs; profileId: string; incognito: boolean; result: string[] };

const NONE: string[] = [];
const shownCache = new WeakMap<string[], Shown>();

const showsLive = (folders: LiveDefs, profileId: string, incognito: boolean) => (id: string) => !incognito && folders[id]?.profileId === profileId;

function withShownLive(entries: string[], folders: LiveDefs, profileId: string, incognito: boolean): string[] {
  if (!entries.some((e) => e.startsWith("l:"))) return entries;
  const cached = shownCache.get(entries);
  if (cached && cached.folders === folders && cached.profileId === profileId && cached.incognito === incognito) return cached.result;
  const shows = showsLive(folders, profileId, incognito);
  const kept = entries.filter((e) => !e.startsWith("l:") || shows(e.slice(2)));
  const result = kept.length === entries.length ? entries : kept;
  shownCache.set(entries, { folders, profileId, incognito, result });
  return result;
}

const incognitoWindow = (s: BrowserState, windowId: string) => !!s.windows[windowId]?.incognito;

function unplacedLive(s: BrowserState, windowId: string, profileId: string): string[] {
  if (incognitoWindow(s, windowId)) return NONE;
  const { folders, folderOrder } = live();
  const table = tableOf(s.pinPlace, profileId);
  return folderOrder.filter((id) => folders[id]?.profileId === profileId && !table[liveNode(id)]);
}

const rootMemo = new Map<string, { inputs: unknown[]; result: string[] }>();

export function pinnedRoot(s: BrowserState, windowId: string, profileId: string): string[] {
  const placed = sidebarEntries(s, windowId, profileId).pinned;
  const { folders, folderOrder } = live();
  const incognito = incognitoWindow(s, windowId);
  const inputs = [placed, s.pinPlace, folders, folderOrder, incognito];
  const key = `${windowId}|${profileId}`;
  const cached = rootMemo.get(key);
  if (cached && cached.inputs.every((v, i) => v === inputs[i])) return cached.result;
  const base = withShownLive(placed, folders, profileId, incognito);
  const extra = unplacedLive(s, windowId, profileId)
    .map((id) => `l:${id}`)
    .filter((e) => !base.includes(e));
  const result = stableList(cached?.result, extra.length ? [...base, ...extra] : base);
  rootMemo.set(key, { inputs, result });
  if (rootMemo.size > 16) for (const k of rootMemo.keys()) if (!s.windows[k.split("|")[0]!]) rootMemo.delete(k);
  return result;
}

export function folderChildrenWith(s: BrowserState, windowId: string, profileId: string, groupId: string, folders: LiveDefs): string[] {
  return withShownLive(groupEntries(s, groupId), folders, profileId, incognitoWindow(s, windowId));
}

export const folderChildren = (s: BrowserState, windowId: string, profileId: string, groupId: string): string[] => folderChildrenWith(s, windowId, profileId, groupId, live().folders);

const untracked = (_s: BrowserState, list: string[]) => list;

export function usePinnedRoot(windowId: string, profileId: string, track: (s: BrowserState, list: string[]) => string[] = untracked): string[] {
  useLive((s) => s.folders);
  useLive((s) => s.folderOrder);
  return useBrowser((s) => track(s, pinnedRoot(s, windowId, profileId)));
}

export const useLiveDefinitions = () => useLive((s) => s.folders);

export function shownNodes(s: BrowserState, windowId: string, profileId: string, parent: string | null): string[] {
  const h = windowHierarchy(s, windowId, profileId);
  const shows = showsLive(live().folders, profileId, incognitoWindow(s, windowId));
  const kids = (h.tree.children.get(parent) ?? NONE).filter((n) => !isLiveNode(n) || shows(keyOfNode(n)));
  if (parent !== null) return kids;
  const extra = unplacedLive(s, windowId, profileId)
    .map(liveNode)
    .filter((n) => !kids.includes(n));
  return extra.length ? [...kids, ...extra] : kids;
}

export function entryNode(s: BrowserState, windowId: string, profileId: string, parent: string | null, entry: string, moving: Set<string>): string | null {
  const id = entry.slice(2);
  if (entry.startsWith("l:")) return liveNode(id);
  if (entry.startsWith("g:")) return s.groups[id] ? groupNode(pinKeyOf(s.groups[id]!)) : null;
  if (entry.startsWith("t:")) return s.tabs[id] ? tabNode(pinKeyOf(s.tabs[id]!)) : null;
  const panes = new Set(s.splits[id]?.tabIds ?? NONE);
  const h = windowHierarchy(s, windowId, profileId);
  return (h.tree.children.get(parent) ?? NONE).find((n) => !moving.has(n) && panes.has(h.tabs.get(n) ?? "")) ?? null;
}

export type ActivePath = { tab: string | null; groups: string[]; live: string | null };
const NO_PATH: ActivePath = { tab: null, groups: NONE, live: null };

export function activePath(s: BrowserState, windowId: string, profileId: string): ActivePath {
  const active = activeTabId(s, windowId, profileId);
  const t = active ? s.tabs[active] : undefined;
  if (!active || !t) return NO_PATH;
  return { tab: active, groups: folderPath(s, windowId, profileId, active), live: t.liveItem && !t.pinned ? t.liveItem.folderId : null };
}

function nodeAncestors(s: BrowserState, windowId: string, profileId: string, node: string): string[] {
  const h = windowHierarchy(s, windowId, profileId);
  return ancestorsOf(h.tree, node).flatMap((n) => {
    const id = h.groups.get(n);
    return id ? [id] : [];
  });
}

export type PathTarget = { kind: "tab" | "group" | "live"; id: string };

export function containersOf(s: BrowserState, windowId: string, profileId: string, target: PathTarget): string[] {
  if (target.kind === "live") return nodeAncestors(s, windowId, profileId, liveNode(target.id));
  if (target.kind === "group") {
    const g = s.groups[target.id];
    return g?.pinned ? nodeAncestors(s, windowId, profileId, groupNode(pinKeyOf(g))) : NONE;
  }
  const path = folderPath(s, windowId, profileId, target.id);
  const today = groupOf(s, target.id);
  return today && !today.pinned && !path.includes(today.id) ? [today.id, ...path] : path;
}

export function hiddenBy(s: BrowserState, windowId: string, profileId: string, target: PathTarget): string[] {
  const path = activePath(s, windowId, profileId);
  if (target.kind === "tab" && target.id === path.tab) return NONE;
  if (target.kind === "group" && path.groups.includes(target.id)) return NONE;
  if (target.kind === "live" && path.live === target.id) return NONE;
  return containersOf(s, windowId, profileId, target).filter((id) => s.groups[id]?.collapsed);
}

export type LiveHeights = ReadonlyMap<string, number>;
let liveHeights: LiveHeights = new Map();
const liveKey = (windowId: string, profileId: string, folderId: string) => `${windowId}|${profileId}|${folderId}`;

const retainedHeights = new Map<string, number>();

export const liveHeightsNow = (): LiveHeights => liveHeights;
export const retainedLiveHeights = (): LiveHeights => retainedHeights;

export function noteLiveHeight(windowId: string, profileId: string, folderId: string, height: number | null) {
  const key = liveKey(windowId, profileId, folderId);
  if (height !== null) retainedHeights.set(key, height);
  if (height === null ? !liveHeights.has(key) : liveHeights.get(key) === height) return;
  const next = new Map(liveHeights);
  if (height === null) next.delete(key);
  else next.set(key, height);
  liveHeights = next;
}

export const liveHeight = (windowId: string, profileId: string, folderId: string, from: LiveHeights = liveHeights): number | null => from.get(liveKey(windowId, profileId, folderId)) ?? null;

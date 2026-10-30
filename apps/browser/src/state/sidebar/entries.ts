import type { BrowserState } from "../browser/store";
import { activeTabId, isPinnedRow, pinKeyOf, viewTabIds } from "../browser/model";
import { hiddenEmptyCard } from "../omnibox/newTabBarPolicy";
import { FAVORITES, groupNode, instancesIn, isGroupNode, isLiveNode, isTabNode, keyOfNode, liveNode, nodesExisting, pinTree, tableOf, tabNode, type PinTree } from "../pins/pinTree";
import { splitRowPanes, splitTabIds, splitTabIdsOf } from "../splits/splits";
import { ancestorIds } from "../groups/groups";
import { splitIndex, stableList } from "../browser/structure";
import { tileCells } from "../pins/tileFolders";
import type { Tab, TabGroup } from "../browser/types";
import { entryKey, parseEntry } from "./entryKey";

type SidebarEntries = { tiles: string[]; cells: string[]; pinned: string[]; list: string[] };

const tabShapes = new WeakMap<BrowserState["tabs"], object>();
let shapedTabs: BrowserState["tabs"] | null = null;
let lastShape: object = {};

const sameShape = (a: Tab | undefined, b: Tab | undefined) =>
  a === b ||
  (!!a &&
    !!b &&
    a.profileId === b.profileId &&
    a.pinKey === b.pinKey &&
    a.pin === b.pin &&
    !a.liveItem === !b.liveItem &&
    !a.url === !b.url &&
    a.page.kind === b.page.kind);

function sameTabShapes(was: BrowserState["tabs"], now: BrowserState["tabs"]): boolean {
  const ids = Object.keys(now);
  return ids.length === Object.keys(was).length && ids.every((id) => sameShape(was[id], now[id]));
}

const groupShapes = new WeakMap<BrowserState["groups"], object>();
let shapedGroups: BrowserState["groups"] | null = null;
let lastGroupShape: object = {};

const sameGroupShape = (a: TabGroup | undefined, b: TabGroup | undefined) =>
  a === b ||
  (!!a && !!b && a.windowId === b.windowId && a.profileId === b.profileId && a.pinned === b.pinned && a.tabIds === b.tabIds && a.pinKey === b.pinKey && a.parentId === b.parentId);

export function groupsShape(groups: BrowserState["groups"]): object {
  const known = groupShapes.get(groups);
  if (known) return known;
  const ids = Object.keys(groups);
  const same = !!shapedGroups && ids.length === Object.keys(shapedGroups).length && ids.every((id) => sameGroupShape(shapedGroups![id], groups[id]));
  if (!same) lastGroupShape = {};
  shapedGroups = groups;
  groupShapes.set(groups, lastGroupShape);
  return lastGroupShape;
}

export function tabsShape(tabs: BrowserState["tabs"]): object {
  const known = tabShapes.get(tabs);
  if (known) return known;
  if (!shapedTabs || !sameTabShapes(shapedTabs, tabs)) lastShape = {};
  shapedTabs = tabs;
  tabShapes.set(tabs, lastShape);
  return lastShape;
}

const memo = new Map<string, { inputs: unknown[]; result: SidebarEntries }>();

export function sidebarEntries(s: BrowserState, windowId: string, profileId?: string): SidebarEntries {
  const w = s.windows[windowId];
  const inputs = [tabsShape(s.tabs), w?.tabIds, profileId ? null : w?.profileId, groupsShape(s.groups), s.splits, s.settings.newTabOpens, s.pinPlace, s.parkedPins];
  const key = profileId ? `${windowId}|${profileId}` : windowId;
  const cached = memo.get(key);
  if (cached && cached.inputs.every((v, i) => v === inputs[i])) return cached.result;
  let result = computeEntries(s, windowId, profileId);
  if (cached) {
    const was = cached.result;
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);
    const tiles = same(result.tiles, was.tiles) ? was.tiles : result.tiles;
    const cells = same(result.cells, was.cells) ? was.cells : result.cells;
    const pinned = same(result.pinned, was.pinned) ? was.pinned : result.pinned;
    const list = same(result.list, was.list) ? was.list : result.list;
    result = tiles === was.tiles && cells === was.cells && pinned === was.pinned && list === was.list ? was : { tiles, cells, pinned, list };
  }
  memo.set(key, { inputs, result });
  if (memo.size > 8) for (const k of memo.keys()) if (!s.windows[k.split("|")[0]!]) memo.delete(k);
  return result;
}

type Hierarchy = { tree: PinTree; tabs: Map<string, string>; groups: Map<string, string> };
const hierarchyMemo = new Map<string, { inputs: unknown[]; result: Hierarchy }>();

export function windowHierarchy(s: BrowserState, windowId: string, profileId: string): Hierarchy {
  const inputs = [tabsShape(s.tabs), s.windows[windowId]?.tabIds, groupsShape(s.groups), s.pinPlace, s.parkedPins];
  const key = `${windowId}|${profileId}`;
  const cached = hierarchyMemo.get(key);
  if (cached && cached.inputs.every((v, i) => v === inputs[i])) return cached.result;
  const w = s.windows[windowId];
  const table = tableOf(s.pinPlace, profileId);
  const inst = w ? instancesIn(s, w, profileId, table) : { tabs: new Map<string, string>(), groups: new Map<string, string>() };
  const result = { tree: pinTree(table, nodesExisting(s, profileId)), tabs: inst.tabs, groups: inst.groups };
  hierarchyMemo.set(key, { inputs, result });
  if (hierarchyMemo.size > 16) for (const k of hierarchyMemo.keys()) if (!s.windows[k.split("|")[0]!]) hierarchyMemo.delete(k);
  return result;
}

function oneParentSplit(s: BrowserState, h: Hierarchy, tabId: string, splits = splitIndex(s.splits)): string {
  const entry = s.tabs[tabId]?.pin ? pinnedRowEntry(s, tabId, splits) : splitEntry(s, tabId, splits);
  const { kind, id } = parseEntry(entry);
  if (kind !== "split") return entry;
  const panes = splitRowPanes(s, s.splits[id]);
  const placed = (pane: string) => [...h.tabs.values()].includes(pane);
  const parentOf = (pane: string) => (placed(pane) ? (h.tree.parent.get(tabNode(pinKeyOf(s.tabs[pane]!))) ?? null) : "today");
  return new Set(panes.map(parentOf)).size === 1 ? entry : entryKey("tab", tabId);
}

function childEntries(s: BrowserState, h: Hierarchy, parent: string | null, splits = splitIndex(s.splits)): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of h.tree.children.get(parent) ?? []) {
    let entry: string | undefined;
    if (isTabNode(n)) {
      const id = h.tabs.get(n);
      if (id) entry = oneParentSplit(s, h, id, splits);
    } else if (isGroupNode(n)) {
      const gid = h.groups.get(n);
      if (gid) entry = entryKey("group", gid);
    } else if (isLiveNode(n)) entry = entryKey("live", keyOfNode(n));
    if (entry && !seen.has(entry)) {
      seen.add(entry);
      out.push(entry);
    }
  }
  return out;
}

function computeEntries(s: BrowserState, windowId: string, profileId?: string): SidebarEntries {
  const w = s.windows[windowId];
  const profile = profileId ?? w?.profileId;
  if (!w || !profile) return { tiles: [], cells: [], pinned: [], list: [] };
  const h = windowHierarchy(s, windowId, profile);
  const splits = splitIndex(s.splits);
  const tiles: string[] = [];
  for (const n of h.tree.children.get(FAVORITES) ?? []) {
    const id = h.tabs.get(n);
    if (id) tiles.push(id);
  }
  const pinned = childEntries(s, h, null, splits);
  const placed = new Set(h.tabs.values());
  const list: string[] = [];
  const groupOf = new Map<string, string>();
  for (const g of Object.values(s.groups)) if (g.windowId === windowId && !g.pinned && !g.parentId) g.tabIds.forEach((id) => groupOf.set(id, g.id));
  const seen = new Set<string>();
  for (const id of viewTabIds(s, windowId, profileId)) {
    if (placed.has(id)) continue;
    const tab = s.tabs[id]!;
    if ((tab.liveItem && !tab.pin) || hiddenEmptyCard(s, tab)) continue;
    if (tab.pin) {
      if (!isPinnedRow(tab)) tiles.push(id);
      else {
        const entry = oneParentSplit(s, h, id, splits);
        if (!seen.has(entry)) pinned.push(entry);
        seen.add(entry);
      }
      continue;
    }
    const groupId = groupOf.get(id);
    const entry = groupId ? entryKey("group", groupId) : oneParentSplit(s, h, id, splits);
    if (seen.has(entry)) continue;
    seen.add(entry);
    list.push(entry);
  }
  return { tiles, cells: tileCells(s.tabs, tiles), pinned, list };
}

export function numberedTabs(s: BrowserState, windowId: string): string[] {
  const { tiles, pinned, list } = sidebarEntries(s, windowId);
  const active = activeTabId(s, windowId);
  const rowTab = (entry: string): string[] => {
    const { kind, id } = parseEntry(entry);
    if (kind === "live") return [];
    if (kind === "group") return groupEntries(s, id).flatMap(rowTab);
    if (kind !== "split") return [id];
    const panes = splitRowPanes(s, s.splits[id]);
    if (active && panes.includes(active)) return [active];
    const last = panes.reduce<string | undefined>((a, b) => (!a || s.tabs[b]!.lastActiveAt > s.tabs[a]!.lastActiveAt ? b : a), undefined);
    return last ? [last] : [];
  };
  return [...tiles, ...pinned.flatMap(rowTab), ...list.flatMap(rowTab)];
}

const groupMemo = new WeakMap<object, { shape: object; windowTabs: string[] | undefined; parked: BrowserState["parkedPins"]; splits: BrowserState["splits"]; groups: object; places: BrowserState["pinPlace"]; result: string[] }>();

const childIndex = new WeakMap<object, Map<string, BrowserState["groups"][string][]>>();
const NO_CHILDREN: BrowserState["groups"][string][] = [];

function childGroups(groups: BrowserState["groups"], parentId: string): BrowserState["groups"][string][] {
  let index = childIndex.get(groups);
  if (!index) {
    index = new Map();
    for (const g of Object.values(groups)) {
      if (!g.parentId) continue;
      const siblings = index.get(g.parentId);
      if (siblings) siblings.push(g);
      else index.set(g.parentId, [g]);
    }
    childIndex.set(groups, index);
  }
  return index.get(parentId) ?? NO_CHILDREN;
}

export function groupEntries(s: BrowserState, groupId: string): string[] {
  const g = s.groups[groupId];
  if (!g) return [];
  const cached = groupMemo.get(g);
  const shape = tabsShape(s.tabs);
  const groups = groupsShape(s.groups);
  const windowTabs = s.windows[g.windowId]?.tabIds;
  if (cached && cached.shape === shape && cached.windowTabs === windowTabs && cached.parked === s.parkedPins && cached.splits === s.splits && cached.groups === groups && cached.places === s.pinPlace) return cached.result;
  const splits = splitIndex(s.splits);
  let out: string[];
  const node = groupNode(pinKeyOf(g));
  const h = windowHierarchy(s, g.windowId, g.profileId);
  if (g.pinned && s.pinPlace[g.profileId]?.[node]) out = childEntries(s, h, node, splits);
  else {
    const seen = new Set<string>();
    const childOf = new Map<string, string>();
    for (const c of childGroups(s.groups, groupId)) for (const id of c.tabIds) childOf.set(id, c.id);
    out = [];
    for (const id of g.tabIds) {
      const child = childOf.get(id);
      const entry = child ? entryKey("group", child) : oneParentSplit(s, h, id, splits);
      if (!seen.has(entry)) {
        seen.add(entry);
        out.push(entry);
      }
    }
  }
  const result = stableList(cached?.result, out);
  groupMemo.set(g, { shape, windowTabs, parked: s.parkedPins, splits: s.splits, groups, places: s.pinPlace, result });
  return result;
}

export function folderPath(s: BrowserState, windowId: string, profileId: string, tabId: string): string[] {
  const h = windowHierarchy(s, windowId, profileId);
  const t = s.tabs[tabId];
  if (!t) return [];
  const node = t.liveItem ? liveNode(t.liveItem.folderId) : tabNode(pinKeyOf(t));
  const direct = Object.values(s.groups).filter((g) => g.windowId === windowId && g.profileId === profileId && g.tabIds.includes(tabId));
  const out = [...new Set(direct.flatMap((g) => [g.id, ...ancestorIds(s.groups, g.id)]))];
  const seen = new Set<string>();
  let cur = h.tree.parent.get(node) ?? null;
  while (cur !== null && cur !== FAVORITES && !seen.has(cur)) {
    seen.add(cur);
    const gid = h.groups.get(cur);
    if (gid && !out.includes(gid)) out.push(gid);
    cur = h.tree.parent.get(cur) ?? null;
  }
  return out;
}

export function holdsTab(s: BrowserState, entry: string, tabId: string): boolean {
  const { kind, id } = parseEntry(entry);
  if (kind === "group") return !!s.groups[id]?.tabIds.includes(tabId);
  if (kind === "split") return !!splitTabIdsOf(s.splits[id])?.includes(tabId);
  return id === tabId;
}

function pinnedRowEntry(s: BrowserState, tabId: string, splits: ReturnType<typeof splitIndex>): string {
  for (const v of splits.get(tabId) ?? []) if (splitRowPanes(s, v).includes(tabId)) return entryKey("split", v.id);
  return entryKey("tab", tabId);
}

function splitEntry(s: BrowserState, tabId: string, splits = splitIndex(s.splits)): string {
  for (const v of splits.get(tabId) ?? []) {
    if (splitTabIds(v).filter((id) => s.tabs[id] && !s.tabs[id]!.pin).length >= 2) return entryKey("split", v.id);
  }
  return entryKey("tab", tabId);
}

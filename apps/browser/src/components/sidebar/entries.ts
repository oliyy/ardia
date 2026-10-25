import type { BrowserState } from "../../store/browser";
import { activeTabId, viewTabIds } from "../../store/model";
import { hiddenEmptyCard } from "../../store/newTabBar";
import { FAVORITES, groupNode, instancesIn, isGroupNode, isLiveNode, isTabNode, keyOfNode, nodesExisting, pinKeyOf, pinTree, tableOf, tabNode, type PinTree } from "../../store/pinTree";
import { splitRowPanes } from "../../store/splits";
import { ancestorIds } from "../../store/groups";
import { splitIndex, stableList } from "../../store/structure";
import { tileCells } from "../../store/tileFolders";

type SidebarEntries = { tiles: string[]; cells: string[]; pinned: string[]; list: string[] };

const memo = new Map<string, { inputs: unknown[]; result: SidebarEntries }>();

export function sidebarEntries(s: BrowserState, windowId: string, profileId?: string): SidebarEntries {
  const inputs = [s.tabs, s.windows, s.groups, s.splits, s.settings.newTabOpens, s.pinPlace, s.parkedPins];
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
  const inputs = [s.tabs, s.windows, s.groups, s.pinPlace, s.parkedPins];
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
  const entry = splitEntry(s, tabId, splits);
  if (!entry.startsWith("s:")) return entry;
  const panes = splitRowPanes(s, s.splits[entry.slice(2)]);
  const placed = (id: string) => [...h.tabs.values()].includes(id);
  const parentOf = (id: string) => (placed(id) ? (h.tree.parent.get(tabNode(pinKeyOf(s.tabs[id]!))) ?? null) : "today");
  return new Set(panes.map(parentOf)).size === 1 ? entry : `t:${tabId}`;
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
      if (gid) entry = `g:${gid}`;
    } else if (isLiveNode(n)) entry = `l:${keyOfNode(n)}`;
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
    if ((tab.liveItem && !tab.pinned) || hiddenEmptyCard(s, tab)) continue;
    if (tab.pinned) {
      if (!tab.pinnedAsRow) tiles.push(id);
      else {
        const entry = oneParentSplit(s, h, id, splits);
        if (!seen.has(entry)) pinned.push(entry);
        seen.add(entry);
      }
      continue;
    }
    const groupId = groupOf.get(id);
    const entry = groupId ? `g:${groupId}` : oneParentSplit(s, h, id, splits);
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
    const id = entry.slice(2);
    if (entry.startsWith("l:")) return [];
    if (entry.startsWith("g:")) return groupEntries(s, id).flatMap(rowTab);
    if (!entry.startsWith("s:")) return [id];
    const panes = splitRowPanes(s, s.splits[id]);
    if (active && panes.includes(active)) return [active];
    const last = panes.reduce<string | undefined>((a, b) => (!a || s.tabs[b]!.lastActiveAt > s.tabs[a]!.lastActiveAt ? b : a), undefined);
    return last ? [last] : [];
  };
  return [...tiles, ...pinned.flatMap(rowTab), ...list.flatMap(rowTab)];
}

const groupMemo = new WeakMap<object, { tabs: BrowserState["tabs"]; splits: BrowserState["splits"]; groups: BrowserState["groups"]; places: BrowserState["pinPlace"]; result: string[] }>();

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
  if (cached && cached.tabs === s.tabs && cached.splits === s.splits && cached.groups === s.groups && cached.places === s.pinPlace) return cached.result;
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
      const entry = child ? `g:${child}` : oneParentSplit(s, h, id, splits);
      if (!seen.has(entry)) {
        seen.add(entry);
        out.push(entry);
      }
    }
  }
  const result = stableList(cached?.result, out);
  groupMemo.set(g, { tabs: s.tabs, splits: s.splits, groups: s.groups, places: s.pinPlace, result });
  return result;
}

export function folderPath(s: BrowserState, windowId: string, profileId: string, tabId: string): string[] {
  const h = windowHierarchy(s, windowId, profileId);
  const t = s.tabs[tabId];
  if (!t) return [];
  const node = t.liveItem ? `l:${t.liveItem.folderId}` : `t:${pinKeyOf(t)}`;
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

function splitEntry(s: BrowserState, tabId: string, splits = splitIndex(s.splits)): string {
  for (const v of splits.get(tabId) ?? []) {
    if (splitRowPanes(s, v).includes(tabId)) return `s:${v.id}`;
  }
  return `t:${tabId}`;
}

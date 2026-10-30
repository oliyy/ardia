import type { BrowserState } from "../browser/store";
import { changedIds } from "../browser/changes";
import { pinKeyOf, ROW_PIN, TILE_PIN } from "../browser/model";
import type { BrowserWindow, Tab, TabPin } from "../browser/types";
import { splitTabIds } from "../splits/splits";
import { FAVORITES, instancesIn, isGroupNode, isLiveNode, isTabNode, keyOfNode, liveNode, nodesExisting, pinTree, tabNode, type PinTable } from "./pinTree";

type Projection = { order: string[]; members: Map<string, string[]>; parents: Map<string, string | undefined>; flags: Map<string, "tile" | "row" | "leaf"> };

function projectProfile(s: Pick<BrowserState, "tabs" | "groups" | "parkedPins" | "splits">, w: BrowserWindow, profileId: string, table: PinTable): Projection {
  const inst = instancesIn(s, w, profileId, table);
  const unplacedLive: string[] = [];
  for (const id of w.tabIds) {
    const folderId = s.tabs[id]?.profileId === profileId ? s.tabs[id]!.liveItem?.folderId : undefined;
    if (folderId && !table[liveNode(folderId)] && !unplacedLive.includes(liveNode(folderId))) unplacedLive.push(liveNode(folderId));
  }
  const tree = pinTree(table, nodesExisting(s, profileId), unplacedLive);
  const order: string[] = [];
  const members = new Map<string, string[]>();
  const flags = new Map<string, "tile" | "row" | "leaf">();
  const parents = new Map<string, string | undefined>();
  for (const n of tree.children.get(FAVORITES) ?? []) {
    const id = inst.tabs.get(n);
    if (id) (order.push(id), flags.set(id, "tile"));
  }
  const itemsOf = (folderId: string) =>
    w.tabIds.filter((id) => {
      const t = s.tabs[id];
      return !!t && t.profileId === profileId && !t.pin && t.liveItem?.folderId === folderId;
    });
  const families = new Map<string, string[]>();
  for (const split of Object.values(s.splits)) {
    if (split.windowId !== w.id) continue;
    const paneIds = splitTabIds(split);
    const nodes = w.tabIds.filter((id) => paneIds.includes(id)).map((id) => s.tabs[id]).filter((t): t is Tab => !!t && t.profileId === profileId).map((t) => tabNode(pinKeyOf(t)));
    if (nodes.length < 2 || nodes.some((node) => !tree.parent.has(node) || tree.parent.get(node) !== tree.parent.get(nodes[0]!))) continue;
    for (const node of nodes) families.set(node, nodes);
  }
  const visit = (parent: string | null, ancestors: string[] = []) => {
    const seen = new Set<string>();
    const siblings = (tree.children.get(parent) ?? []).flatMap((node) => {
      if (seen.has(node)) return [];
      const nodes = families.get(node) ?? [node];
      nodes.forEach((n) => seen.add(n));
      return nodes;
    });
    for (const n of siblings) {
      if (isTabNode(n)) {
        const id = inst.tabs.get(n);
        if (!id) continue;
        order.push(id);
        flags.set(id, parent === null ? "row" : "leaf");
        for (const gid of ancestors) members.get(gid)!.push(id);
      } else if (isGroupNode(n)) {
        const gid = inst.groups.get(n);
        if (gid) {
          if (!members.has(gid)) members.set(gid, []);
          parents.set(gid, parent !== null ? inst.groups.get(parent) : undefined);
        }
        visit(n, gid ? [...ancestors, gid] : ancestors);
      } else if (isLiveNode(n)) order.push(...itemsOf(keyOfNode(n)));
    }
  };
  visit(null);
  return { order, members, parents, flags };
}

const homeOf = (t: Tab) => t.pinnedUrl || t.url || null;

function flagged(t: Tab, kind: "tile" | "row" | "leaf"): Tab {
  const pin: TabPin | null = kind === "tile" ? (t.pin?.as === "tile" ? t.pin : TILE_PIN) : kind === "row" ? (t.pin?.as === "row" ? t.pin : ROW_PIN) : null;
  const pinnedUrl = pin ? homeOf(t) : null;
  if (t.pin === pin && t.pinnedUrl === pinnedUrl) return t;
  return { ...t, pin, pinnedUrl };
}

export function settleWindow(s: BrowserState, windowId: string): BrowserState {
  const w = s.windows[windowId];
  if (!w) return s;
  const profiles: string[] = [];
  for (const id of w.tabIds) {
    const p = s.tabs[id]?.profileId;
    if (p && !profiles.includes(p)) profiles.push(p);
  }
  for (const g of Object.values(s.groups)) if (g.windowId === windowId && g.pinned && !profiles.includes(g.profileId)) profiles.push(g.profileId);
  let tabs = s.tabs;
  let groups = s.groups;
  const head: string[] = [];
  const placed = new Set<string>();
  for (const profileId of profiles) {
    const table = s.pinPlace[profileId];
    const proj = table ? projectProfile(s, w, profileId, table) : null;
    if (proj) {
      for (const [id, kind] of proj.flags) {
        const t = tabs[id]!;
        const next = flagged(t, kind);
        if (next !== t) {
          if (tabs === s.tabs) tabs = { ...s.tabs };
          tabs[id] = next;
        }
      }
      for (const [gid, ids] of proj.members) {
        const g = groups[gid]!;
        const parentId = proj.parents.get(gid);
        if (g.parentId === parentId && g.tabIds.length === ids.length && g.tabIds.every((id, i) => id === ids[i])) continue;
        if (groups === s.groups) groups = { ...s.groups };
        const { parentId: _, ...rest } = g;
        groups[gid] = { ...rest, tabIds: ids, ...(parentId ? { parentId } : {}) };
      }
      for (const id of proj.order) (head.push(id), placed.add(id));
    }
    for (const id of w.tabIds) {
      const t = tabs[id];
      if (t && t.profileId === profileId && t.pin && !placed.has(id)) (head.push(id), placed.add(id));
    }
  }
  if (groups !== s.groups) {
    const claimed = new Set([...placed].filter((id) => !tabs[id]!.pin));
    for (const g of Object.values(groups)) {
      if (g.windowId !== windowId || g.pinned) continue;
      if (!g.tabIds.some((id) => claimed.has(id))) continue;
      if (groups === s.groups) groups = { ...s.groups };
      groups[g.id] = { ...g, tabIds: g.tabIds.filter((id) => !claimed.has(id)) };
    }
  }
  const tabIds = [...head, ...w.tabIds.filter((id) => !placed.has(id))];
  const sameOrder = tabIds.every((id, i) => id === w.tabIds[i]);
  if (sameOrder && tabs === s.tabs && groups === s.groups) return s;
  return { ...s, tabs, groups, windows: sameOrder ? s.windows : { ...s.windows, [windowId]: { ...w, tabIds } } };
}

export function settlePlacement(s: BrowserState): BrowserState {
  let next = s;
  for (const id of Object.keys(s.windows)) next = settleWindow(next, id);
  return next;
}

const PLACE_FIELDS = ["pin", "pinKey", "windowId", "profileId", "liveItem"] as const;

export function placementMayDiffer(s: Pick<BrowserState, "tabs" | "groups" | "windows" | "pinPlace" | "parkedPins" | "splits">, prev: typeof s): boolean {
  if (s.splits !== prev.splits || s.pinPlace !== prev.pinPlace || s.windows !== prev.windows || s.parkedPins !== prev.parkedPins) return true;
  if (s.groups !== prev.groups) for (const id of changedIds(s.groups, prev.groups)) {
    const a = s.groups[id];
    const b = prev.groups[id];
    if (!a || !b || a.tabIds !== b.tabIds || a.parentId !== b.parentId || a.pinned !== b.pinned || a.windowId !== b.windowId || a.profileId !== b.profileId || a.pinKey !== b.pinKey) return true;
  }
  if (s.tabs === prev.tabs) return false;
  for (const id of new Set([...Object.keys(s.tabs), ...Object.keys(prev.tabs)])) {
    const a = s.tabs[id];
    const b = prev.tabs[id];
    if (a === b) continue;
    if (!a || !b) return true;
    if (PLACE_FIELDS.some((f) => a[f] !== b[f])) return true;
  }
  return false;
}

import type { BrowserState } from "../browser/store";
import { newId, pinKeyOf, snapshotTab, tabTitle } from "../browser/model";
import type { BrowserWindow, ClosedGroup, TabGroup } from "../browser/types";
import { pendingRestore } from "../tabs/adoptIds";
import { activated, apply } from "../tabs/tabs";
import { closeQuietly, keptDeletedGroups, MAX_CLOSED_GROUPS, restoreSnapshots, showAboveGroup } from "./closedTabs";
import { groupLabel } from "./tabGrouping";
import {
  displayedSubtree,
  dropNodes,
  FAVORITES,
  groupNode,
  instancesIn,
  isGroupNode,
  isLiveNode,
  isTabNode,
  keyOfNode,
  liveNode,
  nodesExisting,
  pinTree,
  placedAt,
  placeNodes,
  siblingsOf,
  tableOf,
  tabNode,
  withTable,
  type PinTable,
} from "./pinTree";

type LiveLifecycle = { remove(ids: string[]): unknown[]; snapshot(ids: string[]): unknown[]; restore(entries: { snapshot: unknown; id: string }[], profileId: string): void; exists(id: string): boolean };
let liveLifecycle: LiveLifecycle = { remove: () => [], snapshot: () => [], restore: () => {}, exists: () => false };
export const setLiveLifecycle = (lifecycle: LiveLifecycle) => {
  liveLifecycle = lifecycle;
};

export function shownSubtree(s: Pick<BrowserState, "tabs" | "groups" | "parkedPins" | "pinPlace">, g: TabGroup): { table: PinTable; root: string; subtree: string[]; tree: ReturnType<typeof pinTree> } {
  const table = tableOf(s.pinPlace, g.profileId);
  const root = groupNode(pinKeyOf(g));
  const tree = pinTree(table, nodesExisting(s, g.profileId));
  return { table, root, subtree: tree.parent.has(root) ? displayedSubtree(tree, root) : [root], tree };
}

export function folderTree(s: BrowserState, g: TabGroup, w: BrowserWindow, live: (ids: string[]) => unknown[] = liveLifecycle.snapshot) {
  const profileId = g.profileId;
  const { table, root, subtree } = shownSubtree(s, g);
  const inst = instancesIn(s, w, profileId, table);
  const tabNodes = subtree.filter((n) => isTabNode(n) && inst.tabs.has(n));
  const tabIds = tabNodes.map((n) => inst.tabs.get(n)!);
  const liveIds = subtree.filter(isLiveNode).map(keyOfNode);
  const items = Object.values(s.tabs)
    .filter((t) => !!t.liveItem && liveIds.includes(t.liveItem.folderId))
    .map((t) => t.id);
  const folders = subtree.filter(isGroupNode).map((node) => {
    const own = inst.groups.get(node);
    const look = own ? s.groups[own]! : node === root ? g : undefined;
    return { node, name: look?.name ?? "", icon: look?.icon ?? null, color: look?.color ?? null, collapsed: look?.collapsed ?? false };
  });
  const entry: ClosedGroup = {
    kind: "group",
    id: newId("cg"),
    group: { id: g.id, name: groupLabel(s, g), icon: g.icon, color: g.color, pinned: true },
    tabs: tabIds.map((id) => snapshotTab(s.tabs[id]!)),
    tabIds: tabIds.map((id) => pendingRestore(s.tabs[id]!) ?? id),
    windowId: w.id,
    index: w.tabIds.indexOf(tabIds[0] ?? ""),
    closedAt: Date.now(),
    tree: {
      root,
      profileId,
      places: Object.fromEntries(subtree.filter((n) => table[n]).map((n) => [n, table[n]!])),
      tabs: tabNodes,
      folders,
      live: liveIds.length ? live(liveIds) : [],
    },
  };
  return { entry, subtree, inst, tabIds, items };
}

export function closingFolder(s: BrowserState, g: TabGroup, w: BrowserWindow, deleted: boolean): BrowserState {
  const profileId = g.profileId;
  const { entry, subtree, inst, tabIds, items } = folderTree(s, g, w, liveLifecycle.remove);
  const groups = { ...s.groups };
  for (const node of subtree) {
    const own = inst.groups.get(node);
    if (own) delete groups[own];
  }
  const dropped: BrowserState = { ...s, groups, pinPlace: dropNodes(s.pinPlace, profileId, subtree) };
  const closing = [...tabIds, ...items];
  const next = closing.length ? showAboveGroup(s, closeQuietly(dropped, closing), { ...g, tabIds: closing }) : dropped;
  if (w.kind === "private") return next;
  if (deleted) return { ...next, deletedGroups: [...keptDeletedGroups(next.deletedGroups), entry] };
  return { ...next, closedGroups: [...next.closedGroups, entry].slice(-MAX_CLOSED_GROUPS) };
}

export function restoringFolder(s: BrowserState, entry: ClosedGroup, windowId: string, activate = true): [BrowserState, string | null] {
  const tree = entry.tree!;
  const w = s.windows[windowId]!;
  const profileId = s.profiles[tree.profileId] && w.kind !== "private" ? tree.profileId : w.profileId;
  const table = tableOf(s.pinPlace, profileId);
  const taken = new Set<string>();
  for (const t of Object.values(s.tabs)) if (t.profileId === profileId) taken.add(tabNode(pinKeyOf(t)));
  for (const g of Object.values(s.groups)) if (g.profileId === profileId) taken.add(groupNode(pinKeyOf(g)));
  const rename = new Map<string, string>();
  const index = windowId === entry.windowId ? entry.index : undefined;
  const [restored, ids] = restoreSnapshots(
    s,
    windowId,
    entry.tabs.map((tab, i) => ({ tab: { ...tab, profileId, pin: null }, tabId: entry.tabIds?.[i], index: index === undefined || index < 0 ? undefined : index + i })),
  );
  let next = restored;
  const tabs = { ...next.tabs };
  tree.tabs.forEach((node, i) => {
    const id = ids[i];
    if (!id) return;
    const key = keyOfNode(node);
    const free = !table[node] && !taken.has(node);
    if (free) tabs[id] = { ...tabs[id]!, ...(id === key ? {} : { pinKey: key }) };
    rename.set(node, free ? node : tabNode(id));
  });
  const groups = { ...next.groups };
  let rootId: string | null = null;
  for (const f of tree.folders) {
    const key = keyOfNode(f.node);
    const free = !table[f.node] && !taken.has(f.node);
    const id = free && !groups[key] ? key : newId("g");
    if (f.node === tree.root) rootId = id;
    groups[id] = { id, windowId, profileId, name: f.name, icon: f.icon, color: f.color, collapsed: f.collapsed, pinned: true, tabIds: [], createdAt: Date.now(), ...(free && id !== key ? { pinKey: key } : {}) };
    rename.set(f.node, free ? f.node : groupNode(id));
  }
  const snapshots = new Map((tree.live as { id: string }[]).map((snapshot) => [snapshot.id, snapshot]));
  const restoredLive: { snapshot: unknown; id: string }[] = [];
  for (const node of Object.keys(tree.places)) {
    if (!isLiveNode(node)) continue;
    const snapshot = snapshots.get(keyOfNode(node));
    if (!snapshot) continue;
    const clash = !!table[node] || liveLifecycle.exists(keyOfNode(node));
    const id = clash ? newId("lf") : keyOfNode(node);
    rename.set(node, liveNode(id));
    restoredLive.push({ snapshot, id });
  }
  const placed: PinTable = { ...table };
  for (const [node, place] of Object.entries(tree.places)) {
    const target = rename.get(node);
    if (!target) continue;
    const inside = place.parent !== null && rename.has(place.parent) ? rename.get(place.parent)! : null;
    const outside = place.parent !== null && !rename.has(place.parent) && (place.parent === FAVORITES || table[place.parent]) ? place.parent : null;
    placed[target] = placedAt(place, node === tree.root ? outside : (inside ?? outside), place.pos);
  }
  next = { ...next, tabs, groups, pinPlace: withTable(next.pinPlace, profileId, placed) };
  if (restoredLive.length && next.profiles[profileId]) liveLifecycle.restore(restoredLive, profileId);
  return [activate && ids[0] ? apply(next, activated(next, ids[0])) : next, rootId];
}

export function bookmarkableGroup(s: Pick<BrowserState, "tabs" | "groups" | "parkedPins" | "pinPlace">, groupId: string): boolean {
  const g = s.groups[groupId];
  if (!g?.pinned) return !!g;
  const { table, root, subtree } = shownSubtree(s, g);
  return !table[root] || !subtree.some(isLiveNode);
}

export function duplicatingFolder(s: BrowserState, g: TabGroup, w: BrowserWindow): [BrowserState, string] {
  const folder = groupNode(pinKeyOf(g));
  const { entry } = folderTree(s, g, w);
  const [copied, rootId] = restoringFolder(s, { ...entry, tabIds: undefined }, w.id, false);
  if (!rootId || !copied.groups[rootId]) return [copied, ""];
  const table = tableOf(copied.pinPlace, g.profileId);
  const copy = groupNode(pinKeyOf(copied.groups[rootId]!));
  const parent = table[folder]?.parent ?? null;
  const peers = siblingsOf(table, parent).filter((n) => n !== copy);
  const next = peers[peers.indexOf(folder) + 1] ?? null;
  return [{ ...copied, pinPlace: placeNodes(copied.pinPlace, g.profileId, [copy], parent, next) }, rootId];
}

export function fileFolderTree(s: BrowserState, g: TabGroup, profileId: string): boolean {
  const { table, root, tree } = shownSubtree(s, g);
  const w = s.windows[g.windowId];
  if (!g.pinned || !table[root] || !w) return false;
  const inst = instancesIn(s, w, g.profileId, table);
  const write = (node: string, parentId?: string) => {
    const own = inst.groups.get(node);
    const look = own ? s.groups[own] : node === root ? g : undefined;
    const folder = s.addBookmarkFolder({ profileId, title: look ? groupLabel(s, look) : "", parentId });
    for (const child of tree.children.get(node) ?? []) {
      if (isGroupNode(child)) write(child, folder);
      else if (isTabNode(child)) {
        const id = inst.tabs.get(child);
        const t = id ? s.tabs[id] : undefined;
        if (t?.url) s.addBookmark({ profileId, url: t.url, title: tabTitle(t), favicon: t.favicon, parentId: folder });
      }
    }
  };
  write(root);
  return true;
}

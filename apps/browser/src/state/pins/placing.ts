import type { BrowserState } from "../browser/store";
import { ancestorIds, innermostGroupOf, insertAll, leaveGroups, nestGroups, orderSections, placeGroups, reparent, syncGroupOrder } from "../groups/groups";
import { isIncognitoProfile, isPinnedRow, pinKeyOf, ROW_PIN, samePin, TILE_PIN, without } from "../browser/model";
import { splitOf, splitRowHead, splitRowPanes, withSplitRows } from "../splits/splits";
import { markPinned } from "./pinChoices";
import { groupOf, withRowsGrouped } from "./tabGrouping";
import type { BrowserWindow, TabPin, TileFolder } from "../browser/types";
import { pinnedGroupMembers } from "../browser/structure";
import { pinHome } from "./pinHomes";
import { tileFolderOf } from "./tileFolders";
import { anchorFor, anchorUnder, dropNodes, FAVORITES, groupNode, isGroupNode, isLiveNode, placeNodes, siblingsOf, tableOf, tabNode, withLeafPages } from "./pinTree";

export type TabPlacement = {
  pinned: boolean;
  row?: boolean;
  beforeId?: string | null;
  groupId?: string | null;
  beforeNode?: string | null;
  siblings?: string[];
  last?: boolean;
  tileFolder?: TileFolder | null;
};

export function placing(s: BrowserState, ids: string[], p: TabPlacement): BrowserState {
  const first = s.tabs[ids[0] ?? ""];
  const w = first && s.windows[first.windowId];
  if (!first || !w) return s;
  const order = new Map(w.tabIds.map((id, i) => [id, i]));
  const moving = [...new Set(withSplitRows(s, ids))]
    .filter((id) => s.tabs[id]?.windowId === w.id && s.tabs[id]?.profileId === first.profileId)
    .sort((a, b) => order.get(a)! - order.get(b)!);
  if (!moving.length) return s;
  const paired = new Set(moving.filter((id) => splitRowPanes(s, splitOf(s, id)).includes(id)));
  const target = !p.pinned && p.groupId ? s.groups[p.groupId] : undefined;
  if (target && (target.windowId !== w.id || target.profileId !== first.profileId)) return s;
  const movingSet = new Set(moving);

  const tabs = { ...s.tabs };
  let pinChoices = s.pinChoices;
  const pinnedGroupOf = (id: string) => {
    const g = innermostGroupOf(s.groups, id);
    return g?.pinned ? g.id : null;
  };
  const intoPinnedGroup = target?.pinned ? target.id : null;
  for (const id of moving) {
    const t = tabs[id]!;
    const flips = !!t.pin !== p.pinned;
    const row = p.pinned && (paired.has(id) || (p.row ?? isPinnedRow(t)));
    const folder = p.pinned && !row ? (p.tileFolder === undefined ? tileFolderOf(t) : (p.tileFolder ?? undefined)) : undefined;
    const pin: TabPin | null = !p.pinned ? null : row ? ROW_PIN : folder ? { as: "tile", folder } : TILE_PIN;
    if (flips || !samePin(t.pin, pin)) tabs[id] = { ...t, pin, ...(flips ? { pinnedUrl: pinHome(t, p.pinned || !!intoPinnedGroup) } : {}) };
    const placed = flips || (!p.pinned && pinnedGroupOf(id) !== intoPinnedGroup);
    if (placed || isPinnedRow(t) !== row) {
      if ((p.pinned || intoPinnedGroup) && !isIncognitoProfile(t.profileId)) {
        pinChoices = markPinned(pinChoices, t.profileId, { tabs: p.pinned ? [pinKeyOf(t)] : [], placed: placed ? [pinKeyOf(t)] : [] });
      }
    }
  }
  const rest = w.tabIds.filter((id) => !movingSet.has(id));
  let at: number;
  if (p.beforeId && rest.includes(p.beforeId)) at = rest.indexOf(splitRowHead(s, rest, p.beforeId));
  else if (target) {
    const kept = target.tabIds.filter((id) => !movingSet.has(id));
    at = kept.length ? rest.indexOf(kept.at(-1)!) + 1 : Math.min(order.get(target.tabIds[0]!)!, rest.length);
  } else if (p.pinned) {
    const toRow = isPinnedRow(tabs[moving[0]!]);
    const pinnedGroup = toRow && p.last ? pinnedGroupMembers(s.groups) : null;
    at = rest.reduce((last, id, i) => ((tabs[id]?.pin && (toRow || !isPinnedRow(tabs[id]))) || pinnedGroup?.has(id) ? i + 1 : last), 0);
  } else at = rest.length;
  insertAll(rest, at, moving);

  let groups = leaveGroups(s.groups, movingSet);
  if (target) {
    const kept = groups[target.id] ?? target;
    const members = new Set([...kept.tabIds, ...moving]);
    groups = { ...groups, [target.id]: { ...kept, tabIds: rest.filter((id) => members.has(id)) } };
    for (const a of ancestorIds(s.groups, target.id)) if (!groups[a] && s.groups[a]) groups[a] = { ...s.groups[a]!, tabIds: [] };
    groups = reparent(groups, s.groups);
  }
  groups = nestGroups(groups);
  let tabIds = placeGroups(rest, groups, w.id);
  tabIds = orderSections(tabIds, tabs, groups);
  const window: BrowserWindow = { ...w, tabIds };
  const profileId = first.profileId;
  const nodeOf = (id: string) => tabNode(pinKeyOf(s.tabs[id]!));
  let pinPlace = s.pinPlace;
  if (p.pinned || intoPinnedGroup) {
    const parentOf = (id: string) => (intoPinnedGroup ? groupNode(pinKeyOf(target!)) : isPinnedRow(tabs[id]) ? null : FAVORITES);
    const last = Math.max(...moving.map((id) => window.tabIds.indexOf(id)));
    const followingUnder = (parent: string | null): string | null => {
      const table = tableOf(pinPlace, profileId);
      for (const id of window.tabIds.slice(last + 1)) {
        const t = s.tabs[id];
        if (!t || movingSet.has(id) || t.profileId !== profileId) continue;
        const g = groupOf(s, id);
        const node = anchorUnder(table, nodeOf(id), parent) ?? (g?.pinned ? anchorUnder(table, groupNode(pinKeyOf(g)), parent) : null);
        if (node) return node;
      }
      return null;
    };
    const asked = p.beforeId && s.tabs[p.beforeId] ? nodeOf(splitRowHead(s, w.tabIds, p.beforeId)) : null;
    for (const parent of [...new Set(moving.map(parentOf))]) {
      const mine = moving.filter((id) => parentOf(id) === parent);
      const table = tableOf(pinPlace, profileId);
      const anchor = p.beforeNode != null ? anchorFor(table, p.beforeNode, parent, p.siblings) : p.last ? null : ((asked && anchorFor(table, asked, parent, p.siblings)) ?? followingUnder(parent));
      pinPlace = placeNodes(pinPlace, profileId, mine.map(nodeOf), parent, anchor, p.siblings);
    }
    if (intoPinnedGroup) pinPlace = withLeafPages(pinPlace, profileId, moving.map((id) => s.tabs[id]!).filter((t) => !!t.pin));
  } else pinPlace = dropNodes(pinPlace, profileId, moving.map(nodeOf));
  return withoutEmptiedFolders(s, { ...s, tabs, pinChoices, pinPlace, groups: syncGroupOrder(groups, window), windows: { ...s.windows, [w.id]: window } });
}

export function withoutEmptiedFolders(before: BrowserState, after: BrowserState): BrowserState {
  let next = after;
  for (const g of Object.values(after.groups).sort((a, z) => ancestorIds(after.groups, z.id).length - ancestorIds(after.groups, a.id).length)) {
    if (!g.pinned || !before.groups[g.id]?.tabIds.length || g.tabIds.length) continue;
    const node = groupNode(pinKeyOf(g));
    if (siblingsOf(tableOf(next.pinPlace, g.profileId), node).some((child) => isGroupNode(child) || isLiveNode(child))) continue;
    next = { ...next, groups: without(next.groups, [g.id]), pinPlace: dropNodes(next.pinPlace, g.profileId, [node]) };
  }
  return next;
}

function withHomesOf(s: BrowserState, before: BrowserState, ids: string[]): BrowserState {
  const kept = ids.filter((id) => before.tabs[id]?.pinnedUrl && s.tabs[id] && s.tabs[id]!.pinnedUrl !== before.tabs[id]!.pinnedUrl);
  if (!kept.length) return s;
  const tabs = { ...s.tabs };
  for (const id of kept) tabs[id] = { ...tabs[id]!, pinnedUrl: before.tabs[id]!.pinnedUrl };
  return { ...s, tabs };
}

export function groupingOnto(s: BrowserState, ids: string[], targetId: string): [BrowserState, string] {
  const target = s.tabs[targetId];
  const w = target && s.windows[target.windowId];
  if (!w || (target.pin && !isPinnedRow(target)) || groupOf(s, targetId)) return [s, ""];
  const moving = ids.filter((id) => id !== targetId && s.tabs[id]?.windowId === w.id && s.tabs[id]?.profileId === target.profileId);
  if (!moving.length) return [s, ""];
  const after = w.tabIds.slice(w.tabIds.indexOf(targetId) + 1).find((id) => !moving.includes(id)) ?? null;
  const placed = placing(s, moving, { pinned: false, beforeId: after });
  const [next, id] = withRowsGrouped(isPinnedRow(target) ? withHomesOf(placed, s, moving) : placed, [targetId, ...moving], { pinned: false });
  return id ? [{ ...next, selection: { ...next.selection, [w.id]: [] } }, id] : [s, ""];
}

import type { BrowserState } from "../browser/store";
import { inPinnedContainer, isIncognitoProfile, viewTabIds } from "../browser/model";
import { innermostGroupOf, nestGroups, orderSections, placeGroups, syncGroupOrder } from "../groups/groups";
import { groupLabel, withGroup } from "../pins/tabGrouping";
import { placing } from "../pins/placing";
import { isRegularWindow } from "../windows/small";
import type { TabGroup } from "../browser/types";

export const TIDY_MIN_TABS = 4;

export type TidyTab = { id: string; tabId: string; title: string; url: string; folder: string | null };
export type TidyFolder = { id: string; groupId: string; name: string; tabs: string[] };
export type TidyInput = { windowId: string; profileId: string; tabs: TidyTab[]; folders: TidyFolder[]; pinnedFolders: { name: string; tabs: string[] }[] };
export type TidyReplyFolder = { folder: string | null; name: string | null; tabs: string[] };

export type TidiedTabs = {
  windowId: string;
  profileId: string;
  order: string[];
  scope: string[];
  groups: TabGroup[];
  created: string[];
  tabs: number;
  folders: number;
};

const unpinnedIn = (s: BrowserState, windowId: string, profileId: string) => viewTabIds(s, windowId, profileId).filter((id) => !inPinnedContainer(s, id) && !s.tabs[id]?.liveItem);

const sortableIn = (s: BrowserState, windowId: string, profileId: string) => unpinnedIn(s, windowId, profileId).filter((id) => !!s.tabs[id]?.url);

const unpinnedGroupsIn = (s: Pick<BrowserState, "groups">, windowId: string, profileId: string) =>
  Object.values(s.groups).filter((g) => !g.pinned && g.windowId === windowId && g.profileId === profileId);

export function canTidyTabs(s: BrowserState, windowId: string, profileId: string): boolean {
  if (isIncognitoProfile(profileId) || !isRegularWindow(s.windows[windowId])) return false;
  return sortableIn(s, windowId, profileId).length >= TIDY_MIN_TABS;
}

export function tidyInput(s: BrowserState, windowId: string, profileId: string): TidyInput | null {
  if (!canTidyTabs(s, windowId, profileId)) return null;
  const ids = sortableIn(s, windowId, profileId);
  const order = new Map(ids.map((id, i) => [id, i]));
  const groups = unpinnedGroupsIn(s, windowId, profileId)
    .filter((g) => g.tabIds.length)
    .sort((a, z) => (order.get(a.tabIds[0]!) ?? 0) - (order.get(z.tabIds[0]!) ?? 0));
  const folderIds = new Map(groups.map((g, i) => [g.id, `f${i + 1}`]));
  const titleOf = (id: string) => s.tabs[id]?.customTitle || s.tabs[id]?.title || s.tabs[id]?.url || "";
  const tabs = ids.map((tabId, i) => {
    const t = s.tabs[tabId]!;
    const home = innermostGroupOf(s.groups, tabId);
    return { id: `t${i + 1}`, tabId, title: titleOf(tabId), url: t.url, folder: home ? (folderIds.get(home.id) ?? null) : null };
  });
  const folders = groups.map((g) => ({ id: folderIds.get(g.id)!, groupId: g.id, name: groupLabel(s, g), tabs: g.tabIds.map(titleOf) }));
  const pinnedFolders = Object.values(s.groups)
    .filter((g) => g.pinned && g.windowId === windowId && g.profileId === profileId && g.tabIds.length)
    .map((g) => ({ name: groupLabel(s, g), tabs: g.tabIds.map(titleOf) }));
  return { windowId, profileId, tabs, folders, pinnedFolders };
}

type Move = { groupId: string | null; name: string | null; tabIds: string[] };

function validMoves(s: BrowserState, input: TidyInput, reply: TidyReplyFolder[]): Move[] {
  const tabFor = new Map(input.tabs.map((t) => [t.id, t.tabId]));
  const usable = (groupId: string | undefined) => {
    const g = groupId ? s.groups[groupId] : undefined;
    return g && !g.pinned && g.windowId === input.windowId && g.profileId === input.profileId ? g : undefined;
  };
  const byId = new Map(input.folders.map((f) => [f.id, f.groupId]));
  const byName = new Map(input.folders.map((f) => [f.name.trim().toLowerCase(), f.groupId]));
  const live = new Set(unpinnedIn(s, input.windowId, input.profileId));
  const taken = new Set<string>();
  const moves: Move[] = [];
  for (const f of reply) {
    const name = f.name?.trim() || null;
    const g = f.folder ? usable(byId.get(f.folder)) : name ? usable(byName.get(name.toLowerCase())) : undefined;
    if (!g && (f.folder || !name)) continue;
    const tabIds: string[] = [];
    for (const short of f.tabs) {
      const tabId = tabFor.get(short);
      if (!tabId || taken.has(tabId) || !live.has(tabId)) continue;
      taken.add(tabId);
      if (g && innermostGroupOf(s.groups, tabId)?.id === g.id) continue;
      tabIds.push(tabId);
    }
    if (g ? tabIds.length : tabIds.length >= 2) moves.push({ groupId: g?.id ?? null, name: g ? null : name, tabIds });
  }
  return moves;
}

export function tidyingTabs(s: BrowserState, input: TidyInput, reply: TidyReplyFolder[]): [BrowserState, TidiedTabs | null] {
  const w = s.windows[input.windowId];
  if (!w || !canTidyTabs(s, input.windowId, input.profileId)) return [s, null];
  const moves = validMoves(s, input, reply);
  if (!moves.length) return [s, null];
  const scope = unpinnedIn(s, input.windowId, input.profileId);
  const groups = unpinnedGroupsIn(s, input.windowId, input.profileId);
  let next = s;
  const created: string[] = [];
  const reached = new Set<string>();
  let moved = 0;
  for (const m of moves) {
    const ids = m.tabIds.filter((id) => next.tabs[id]?.windowId === w.id && !inPinnedContainer(next, id));
    if (m.groupId) {
      if (!next.groups[m.groupId] || !ids.length) continue;
      next = placing(next, ids, { pinned: false, groupId: m.groupId });
      reached.add(m.groupId);
    } else {
      if (ids.length < 2) continue;
      const [grouped, id] = withGroup(next, ids, { name: m.name!, pinned: false, parentId: null });
      if (!id) continue;
      next = grouped;
      created.push(id);
      reached.add(id);
    }
    moved += ids.length;
  }
  if (!moved) return [s, null];
  return [next, { windowId: w.id, profileId: input.profileId, order: [...w.tabIds], scope, groups, created, tabs: moved, folders: reached.size }];
}

export function untidyingTabs(s: BrowserState, tidied: TidiedTabs): BrowserState {
  const w = s.windows[tidied.windowId];
  if (!w) return s;
  const live = new Set(unpinnedIn(s, w.id, tidied.profileId));
  const back = new Set(tidied.scope.filter((id) => live.has(id)));
  const created = new Set(tidied.created);
  const groups: Record<string, TabGroup> = {};
  for (const g of Object.values(s.groups)) {
    if (created.has(g.id)) continue;
    groups[g.id] = g.pinned || g.windowId !== w.id ? g : { ...g, tabIds: g.tabIds.filter((id) => !back.has(id)) };
  }
  for (const was of tidied.groups) {
    const members = was.tabIds.filter((id) => back.has(id));
    if (!members.length) continue;
    const now = groups[was.id];
    if (now && (now.pinned || now.windowId !== w.id || now.profileId !== tidied.profileId)) continue;
    const kept = now ? now.tabIds : [];
    const { tabIds: _, ...rest } = now ?? was;
    groups[was.id] = { ...rest, ...(was.parentId && groups[was.parentId] ? { parentId: was.parentId } : {}), tabIds: [...kept, ...members] };
  }
  for (const g of Object.values(groups)) if (!g.pinned && !g.tabIds.length) delete groups[g.id];

  let tabIds = w.tabIds.filter((id) => !back.has(id));
  const returning = tidied.order.filter((id) => back.has(id));
  for (let i = returning.length - 1; i >= 0; i--) {
    const id = returning[i]!;
    const later = tidied.order.slice(tidied.order.indexOf(id) + 1).find((o) => tabIds.includes(o));
    const at = later ? tabIds.indexOf(later) : tabIds.length;
    tabIds = [...tabIds.slice(0, at), id, ...tabIds.slice(at)];
  }
  const nested = nestGroups(groups);
  tabIds = orderSections(placeGroups(tabIds, nested, w.id), s.tabs, nested);
  const window = { ...w, tabIds };
  return { ...s, groups: syncGroupOrder(nested, window), windows: { ...s.windows, [w.id]: window } };
}

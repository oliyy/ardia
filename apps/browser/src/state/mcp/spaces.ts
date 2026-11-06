import type { BrowserState } from "../browser/store";
import type { BrowserWindow, Tab, TabGroup } from "../browser/types";
import { activeTabId, inPinnedContainer, isIncognitoProfile, pinSection, tabTitle, viewTabIds } from "../browser/model";
import { ancestorIds, innermostGroupOf } from "../groups/groups";
import { groupLabel } from "../pins/tabGrouping";
import { isRegularWindow } from "../windows/small";

export class McpToolError extends Error {}

export const fail = (message: string): never => {
  throw new McpToolError(message);
};

export const spaceIds = (s: BrowserState) => s.profileOrder.filter((id) => !!s.profiles[id] && !isIncognitoProfile(id));

const regularWindows = (s: BrowserState): BrowserWindow[] =>
  [...new Set([...s.ui.focusOrder, ...s.windowOrder])].map((id) => s.windows[id]).filter((w): w is BrowserWindow => isRegularWindow(w));

export const currentSpace = (s: BrowserState): string | undefined => regularWindows(s).find((w) => spaceIds(s).includes(w.profileId))?.profileId;

export function spaceWindow(s: BrowserState, profileId: string): BrowserWindow {
  const windows = regularWindows(s);
  const holds = (w: BrowserWindow) => w.tabIds.some((id) => s.tabs[id]?.profileId === profileId);
  return windows.find((w) => w.profileId === profileId) ?? windows.find(holds) ?? windows[0] ?? fail("No Ardia window is open");
}

export function resolveSpace(s: BrowserState, space: unknown): string {
  if (space === undefined || space === null) return currentSpace(s) ?? fail("No Ardia window is open");
  if (typeof space !== "string" || !space.trim()) return fail("space must be a space id or name");
  const ids = spaceIds(s);
  if (ids.includes(space)) return space;
  const named = ids.filter((id) => s.profiles[id]!.name.trim().toLowerCase() === space.trim().toLowerCase());
  if (named.length === 1) return named[0]!;
  return fail(named.length ? `More than one space is named ${space}; use its id` : `No space ${space}; list_spaces names them`);
}

export function tabIn(s: BrowserState, id: unknown): Tab {
  const tab = typeof id === "string" ? s.tabs[id] : undefined;
  if (!tab || isIncognitoProfile(tab.profileId) || !isRegularWindow(s.windows[tab.windowId])) return fail(`No tab ${String(id)}`);
  return tab;
}

export function folderIn(s: BrowserState, id: unknown): TabGroup {
  const group = typeof id === "string" ? s.groups[id] : undefined;
  if (!group || isIncognitoProfile(group.profileId) || !isRegularWindow(s.windows[group.windowId])) return fail(`No folder ${String(id)}`);
  return group;
}

export const isFavorite = (tab: Tab) => pinSection(tab) === "tile";

export const isLiveTab = (tab: Tab) => !!tab.liveItem;

export const isFixedTab = (tab: Tab) => isFavorite(tab) || isLiveTab(tab);

export const isPinnedTab = (s: BrowserState, id: string) => !!s.tabs[id] && !isFixedTab(s.tabs[id]!) && inPinnedContainer(s, id);

export const isPinnedFolder = (s: BrowserState, g: TabGroup) => g.pinned || ancestorIds(s.groups, g.id).some((a) => s.groups[a]?.pinned);

const fixedTabMessage = (tab: Tab) =>
  isFavorite(tab) ? `${tab.id} is a favorite; favorites can't be changed here` : `${tab.id} is in a live folder; live-folder tabs can't be changed here`;

export function tabsIn(s: BrowserState, ids: unknown): Tab[] {
  if (!Array.isArray(ids) || !ids.length) return fail("ids must list one or more tab ids");
  return [...new Set(ids)].map((id) => tabIn(s, id));
}

export function editableTab(s: BrowserState, id: unknown): Tab {
  const tab = tabIn(s, id);
  if (isFixedTab(tab)) fail(fixedTabMessage(tab));
  return tab;
}

export function editableTabs(s: BrowserState, ids: unknown): Tab[] {
  const tabs = tabsIn(s, ids);
  const fixed = tabs.find(isFixedTab);
  if (fixed) fail(fixedTabMessage(fixed));
  return tabs;
}

export function unpinnedTabs(s: BrowserState, ids: unknown): Tab[] {
  const tabs = editableTabs(s, ids);
  const pinned = tabs.find((t) => isPinnedTab(s, t.id));
  if (pinned) fail(`${pinned.id} is pinned; pinned tabs can't be closed here`);
  return tabs;
}

export function refuseUnpinning(s: BrowserState, tabs: Tab[], hint: string) {
  const pinned = tabs.find((t) => isPinnedTab(s, t.id));
  if (pinned) fail(`${pinned.id} is pinned and that would unpin it; ${hint}`);
}

export function unpinnedFolder(s: BrowserState, id: unknown): TabGroup {
  const group = folderIn(s, id);
  if (isPinnedFolder(s, group)) fail(`${group.id} is a pinned folder; pinned folders can't be deleted here`);
  return group;
}

export function keepsPins(before: BrowserState, after: BrowserState, movedFolders: ReadonlyMap<string, string> = new Map()) {
  if (before === after) return;
  for (const id of Object.keys(before.tabs)) {
    if (isPinnedTab(before, id) && !(after.tabs[id] && isPinnedTab(after, id))) fail(`That would close or unpin pinned tab ${id}, so nothing changed`);
  }
  for (const g of Object.values(before.groups)) {
    if (!isPinnedFolder(before, g)) continue;
    const now = after.groups[movedFolders.get(g.id) ?? g.id];
    if (!now || !isPinnedFolder(after, now)) fail(`That would delete or unpin pinned folder ${g.id}, so nothing changed`);
  }
}

export function sameWindow(tabs: Tab[]): string {
  const windowId = tabs[0]!.windowId;
  if (tabs.some((t) => t.windowId !== windowId)) fail("The tabs are in different windows; move them one window at a time");
  return windowId;
}

function tabEntry(s: BrowserState, id: string, active: string | undefined) {
  const t = s.tabs[id]!;
  const folder = innermostGroupOf(s.groups, id)?.id ?? (t.pin?.as === "tile" ? t.pin.folder?.id : undefined);
  return {
    id,
    title: tabTitle(t),
    url: t.url || t.pinnedUrl || "",
    ...(folder ? { folder } : {}),
    ...(id === active ? { active: true } : {}),
    ...(isPinnedTab(s, id) ? { pinned: true } : {}),
    ...(isFixedTab(t) ? { locked: true } : {}),
  };
}

function folderEntry(s: BrowserState, g: TabGroup) {
  return { id: g.id, name: groupLabel(s, g), ...(g.parentId ? { parent: g.parentId } : {}), ...(isPinnedFolder(s, g) ? { pinned: true } : {}) };
}

function tileFolders(s: BrowserState, ids: string[]) {
  const seen = new Map<string, string>();
  for (const id of ids) {
    const pin = s.tabs[id]!.pin;
    if (pin?.as === "tile" && pin.folder) seen.set(pin.folder.id, pin.folder.name);
  }
  return [...seen].map(([id, name]) => ({ id, name, locked: true }));
}

export function listTabs(s: BrowserState, profileId: string) {
  const w = spaceWindow(s, profileId);
  const ids = viewTabIds(s, w.id, profileId);
  const active = activeTabId(s, w.id, profileId);
  const order = new Map(ids.map((id, i) => [id, i]));
  const at = (g: TabGroup) => (g.tabIds.length ? (order.get(g.tabIds[0]!) ?? Infinity) : Infinity);
  const groups = Object.values(s.groups)
    .filter((g) => g.windowId === w.id && g.profileId === profileId)
    .sort((a, z) => at(a) - at(z));
  const favorites = ids.filter((id) => isFavorite(s.tabs[id]!));
  const pinned = ids.filter((id) => isPinnedTab(s, id) || isLiveTab(s.tabs[id]!));
  const pinnedSet = new Set(pinned);
  const unpinned = ids.filter((id) => !isFavorite(s.tabs[id]!) && !pinnedSet.has(id));
  return {
    space: { id: profileId, name: s.profiles[profileId]?.name ?? profileId },
    favorites: { tabs: favorites.map((id) => tabEntry(s, id, active)), folders: tileFolders(s, favorites) },
    pinned: { tabs: pinned.map((id) => tabEntry(s, id, active)), folders: groups.filter((g) => isPinnedFolder(s, g)).map((g) => folderEntry(s, g)) },
    unpinned: { tabs: unpinned.map((id) => tabEntry(s, id, active)), folders: groups.filter((g) => !isPinnedFolder(s, g)).map((g) => folderEntry(s, g)) },
  };
}

export function listSpaces(s: BrowserState) {
  const current = currentSpace(s);
  return spaceIds(s).map((id) => {
    const { favorites, pinned, unpinned } = listTabs(s, id);
    return {
      id,
      name: s.profiles[id]!.name,
      ...(id === current ? { current: true } : {}),
      favorites: favorites.tabs.length,
      pinned: pinned.tabs.length,
      unpinned: unpinned.tabs.length,
      folders: unpinned.folders.length,
    };
  });
}

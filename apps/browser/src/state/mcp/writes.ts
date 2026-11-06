import type { BrowserState } from "../browser/store";
import type { Tab, TabGroup } from "../browser/types";
import { inPinnedContainer, isPinnedRow, pinSection, viewTabIds } from "../browser/model";
import { ancestorIds, descendantIds, innermostGroupOf } from "../groups/groups";
import { placing } from "../pins/placing";
import { movingGroup, withRowsGrouped } from "../pins/tabGrouping";
import { withNewTab } from "../tabs/tabs";
import { groupIntoProfile, intoProfile } from "../windows/profileMoves";
import { samePage } from "../../lib/url";
import { editableTabs, fail, folderIn, isFixedTab, isPinnedFolder, isPinnedTab, refuseUnpinning, resolveSpace, sameWindow, spaceWindow, tabIn } from "./spaces";

export type Args = Record<string, unknown>;
export type Change = [BrowserState, Record<string, unknown>, ReadonlyMap<string, string>?];

const NAME_LIMIT = 100;

export function webUrl(value: unknown): string {
  if (typeof value !== "string") return fail("url must be an http or https URL");
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return fail("url must be an http or https URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") fail("url must be an http or https URL");
  return parsed.href;
}

export function folderName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) fail("name must be a folder name");
  if (name.length > NAME_LIMIT) fail(`name must be at most ${NAME_LIMIT} characters`);
  return name;
}

const optionalIndex = (value: unknown): number | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return fail("index must be a whole number from 0");
  return value;
};

const optionalFlag = (value: unknown, key: string, fallback: boolean): boolean => {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") return fail(`${key} must be true or false`);
  return value;
};

function intoSpace(s: BrowserState, tabs: Tab[], profileId: string): BrowserState {
  let next = s;
  for (const t of tabs) {
    if (next.tabs[t.id]?.profileId === profileId) continue;
    next = intoProfile(next, t.id, profileId);
    if (next.tabs[t.id]?.profileId !== profileId) fail(`${t.id} can't move to another space right now`);
  }
  return next;
}

const optionalSpace = (s: BrowserState, value: unknown): string | null => (value === undefined || value === null ? null : resolveSpace(s, value));

const optionalFolder = (s: BrowserState, value: unknown, key: string): TabGroup | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return fail(`${key} must be a folder id`);
  return folderIn(s, value);
};

function destinationFolder(s: BrowserState, id: unknown, windowId: string, profileId: string | null, key = "folder"): TabGroup | null {
  const folder = optionalFolder(s, id, key);
  if (!folder) return null;
  if (folder.windowId !== windowId) fail(`${folder.id} is in another window`);
  if (profileId && folder.profileId !== profileId) fail(`${folder.id} is in another space`);
  return folder;
}

function section(s: BrowserState, folder: TabGroup | null, pinned: unknown, fallback: boolean): boolean {
  if (!folder) return optionalFlag(pinned, "pinned", fallback);
  const inside = isPinnedFolder(s, folder);
  if (pinned !== undefined && pinned !== null && optionalFlag(pinned, "pinned", inside) !== inside) {
    fail(`${folder.id} is ${inside ? "a pinned" : "an unpinned"} folder; leave pinned out when giving a folder`);
  }
  return inside;
}

export function tabName(value: unknown): string {
  if (typeof value !== "string") return fail("name must be text; an empty name goes back to the page title");
  const name = value.trim();
  if (name.length > NAME_LIMIT) fail(`name must be at most ${NAME_LIMIT} characters`);
  return name;
}

export function openTab(s: BrowserState, a: Args): Change {
  const url = webUrl(a.url);
  const profileId = resolveSpace(s, a.space);
  const w = spaceWindow(s, profileId);
  const folder = destinationFolder(s, a.folder, w.id, profileId);
  const [opened, id] = withNewTab(s, w.id, { url, profileId, background: optionalFlag(a.background, "background", true) });
  if (!id) fail("The tab couldn't be opened");
  const next = folder ? placing(opened, [id], { pinned: false, groupId: folder.id }) : opened;
  if (folder && innermostGroupOf(next.groups, id)?.id !== folder.id) fail("The tab couldn't be opened in that folder");
  return [next, { opened: id, space: profileId, ...(folder ? { folder: folder.id, pinned: isPinnedFolder(next, folder) } : {}) }];
}

const unpinnedList = (s: BrowserState, windowId: string, profileId: string) =>
  viewTabIds(s, windowId, profileId).filter((id) => !inPinnedContainer(s, id) && !s.tabs[id]!.liveItem);

const pinnedList = (s: BrowserState, windowId: string, profileId: string) => viewTabIds(s, windowId, profileId).filter((id) => isPinnedRow(s.tabs[id]));

export function moveTabs(s: BrowserState, a: Args): Change {
  const tabs = editableTabs(s, a.ids);
  const windowId = sameWindow(tabs);
  const asked = optionalSpace(s, a.space);
  const folder = destinationFolder(s, a.folder, windowId, asked);
  const pinned = section(s, folder, a.pinned, false);
  if (!pinned) refuseUnpinning(s, tabs, "move it into a pinned folder or pass pinned: true");
  const profileId = asked ?? folder?.profileId ?? tabs[0]!.profileId;
  const index = optionalIndex(a.index);
  let next = intoSpace(s, tabs, profileId);
  const ids = tabs.map((t) => t.id);
  const target = folder ? next.groups[folder.id] : undefined;
  if (folder && !target) fail(`${folder.id} is gone`);
  const moving = new Set(ids);
  const destination = (target ? target.tabIds : pinned ? pinnedList(next, windowId, profileId) : unpinnedList(next, windowId, profileId)).filter((id) => !moving.has(id));
  const beforeId = index === undefined ? undefined : destination[index];
  const at = beforeId ? { beforeId } : {};
  next = target
    ? placing(next, ids, { pinned: false, groupId: target.id, ...at })
    : pinned
      ? placing(next, ids, { pinned: true, row: true, ...(beforeId ? at : { last: true }) })
      : placing(next, ids, { pinned: false, groupId: null, ...at });
  const landed = (id: string) =>
    next.tabs[id]?.profileId === profileId &&
    isPinnedTab(next, id) === pinned &&
    (target ? innermostGroupOf(next.groups, id)?.id === target.id : pinned ? isPinnedRow(next.tabs[id]) : !innermostGroupOf(next.groups, id));
  if (!ids.every(landed)) fail("The tabs couldn't be moved there");
  return [next, { moved: ids, space: profileId, folder: target?.id ?? null, pinned }];
}

export function createFolder(s: BrowserState, a: Args): Change {
  const name = folderName(a.name);
  const tabs = editableTabs(s, a.ids);
  const windowId = sameWindow(tabs);
  const asked = optionalSpace(s, a.space);
  const parent = destinationFolder(s, a.parent, windowId, asked, "parent");
  const pinned = section(s, parent, a.pinned, false);
  if (!pinned) refuseUnpinning(s, tabs, "give a pinned parent or pass pinned: true");
  const profileId = asked ?? parent?.profileId ?? tabs[0]!.profileId;
  const moved = intoSpace(s, tabs, profileId);
  const [next, id] = withRowsGrouped(moved, tabs.map((t) => t.id), { name, pinned, parentId: parent?.id ?? null });
  const made = id ? next.groups[id] : undefined;
  if (!made || isPinnedFolder(next, made) !== pinned || made.parentId !== parent?.id || !tabs.every((t) => made.tabIds.includes(t.id))) fail("The folder couldn't be made");
  return [next, { folder: id, name, space: profileId, parent: parent?.id ?? null, pinned, tabs: made!.tabIds }];
}

type FolderEntry = { key: string; firstTab: string };

function childEntries(s: BrowserState, windowId: string, profileId: string, parent: TabGroup | null, pinned: boolean, except: ReadonlySet<string>): FolderEntry[] {
  const entries: FolderEntry[] = [];
  const seen = new Set<string>();
  const inSection = (id: string) => (pinned ? isPinnedTab(s, id) : !inPinnedContainer(s, id) && !s.tabs[id]!.liveItem);
  for (const id of viewTabIds(s, windowId, profileId)) {
    if (except.has(id) || !inSection(id) || (parent && !parent.tabIds.includes(id))) continue;
    const inner = innermostGroupOf(s.groups, id);
    const chain = inner ? [inner.id, ...ancestorIds(s.groups, inner.id)] : [];
    const child = chain.find((g) => s.groups[g]!.parentId === parent?.id && g !== parent?.id);
    const key = child ?? id;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ key, firstTab: id });
  }
  return entries;
}

export function moveFolder(s: BrowserState, a: Args): Change {
  const folder = folderIn(s, a.id);
  const wasPinned = isPinnedFolder(s, folder);
  const asked = optionalSpace(s, a.space);
  const named = destinationFolder(s, a.parent, folder.windowId, asked, "parent");
  const profileId = asked ?? named?.profileId ?? folder.profileId;
  const crossing = profileId !== folder.profileId;
  const current = folder.parentId ? (s.groups[folder.parentId] ?? null) : null;
  const parent = a.parent !== undefined ? named : crossing ? null : current;
  const index = optionalIndex(a.index);
  if (!crossing && a.parent === undefined && a.pinned === undefined && index === undefined) fail("Give space, parent, pinned or index");
  if (parent && (parent.id === folder.id || descendantIds(s.groups, folder.id).includes(parent.id))) fail(`${folder.id} can't go inside itself or one of its own folders`);
  const pinned = section(s, parent, a.pinned, wasPinned);
  if (wasPinned && !pinned) fail(`${folder.id} is a pinned folder and that would unpin it; give a pinned parent or keep it in the pinned section`);
  const fixed = folder.tabIds.map((id) => s.tabs[id]).find((t) => t && isFixedTab(t));
  if (fixed) fail(`${folder.id} holds ${fixed.id}, which can't be changed here`);
  let next = s;
  let id = folder.id;
  let renamed = new Map<string, string>();
  if (crossing) {
    [next, renamed] = groupIntoProfile(s, folder.id, profileId);
    id = renamed.get(folder.id) ?? "";
    const moved = next.groups[id];
    if (!moved || moved.profileId !== profileId || !folder.tabIds.every((t) => next.tabs[t]?.profileId === profileId)) fail(`${folder.id} can't move to another space right now`);
  }
  if (!crossing || parent || index !== undefined || pinned !== wasPinned) {
    const g = next.groups[id]!;
    const entries = childEntries(next, g.windowId, profileId, parent ? next.groups[parent.id]! : null, pinned, new Set(g.tabIds));
    const beforeId = index === undefined ? undefined : entries[index]?.firstTab;
    const placed = movingGroup(next, id, { pinned, parentId: parent?.id ?? null, ...(beforeId ? { beforeId } : {}) });
    if (!placed.groups) fail(`${folder.id} can't go there`);
    next = { ...next, ...placed };
  }
  const now = next.groups[id];
  if (!now || now.profileId !== profileId || isPinnedFolder(next, now) !== pinned || (now.parentId ?? null) !== (parent?.id ?? null)) fail(`${folder.id} couldn't be moved there`);
  return [next, { moved: folder.id, folder: id, space: profileId, parent: parent?.id ?? null, pinned }, renamed];
}

function newPinned(s: BrowserState, a: Args, row: boolean): Change {
  if ((a.id === undefined) === (a.url === undefined)) fail("Give either id or url");
  let next = s;
  let id: string;
  let url: string;
  if (a.id !== undefined) {
    const tab = tabIn(s, a.id);
    if (inPinnedContainer(s, tab.id) || isFixedTab(tab)) fail(`${tab.id} is already pinned or a favorite`);
    if (a.space !== undefined && a.space !== null && resolveSpace(s, a.space) !== tab.profileId) fail(`${tab.id} is in another space; move it there first`);
    id = tab.id;
    url = tab.url;
  } else {
    url = webUrl(a.url);
    const profileId = resolveSpace(s, a.space);
    [next, id] = withNewTab(s, spaceWindow(s, profileId).id, { url, profileId, background: true });
    if (!id) fail("The tab couldn't be opened");
  }
  const profileId = next.tabs[id]!.profileId;
  if (!row && url && Object.values(s.tabs).some((t) => t.profileId === profileId && pinSection(t) === "tile" && samePage(t.pinnedUrl || t.url, url))) {
    fail("That site is already a favorite in this space");
  }
  next = placing(next, [id], { pinned: true, row, last: true, ...(row ? {} : { tileFolder: null }) });
  if (pinSection(next.tabs[id]) !== (row ? "row" : "tile")) fail(row ? "The tab couldn't be pinned" : "The favorite couldn't be added");
  return [next, { [row ? "pinned" : "favorite"]: id, space: profileId }];
}

export const pinTab = (s: BrowserState, a: Args) => newPinned(s, a, true);

export const addFavorite = (s: BrowserState, a: Args) => newPinned(s, a, false);

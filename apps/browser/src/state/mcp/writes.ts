import type { BrowserState } from "../browser/store";
import type { Tab, TabGroup } from "../browser/types";
import { pinSection, viewTabIds } from "../browser/model";
import { placing } from "../pins/placing";
import { withGroup } from "../pins/tabGrouping";
import { withNewTab } from "../tabs/tabs";
import { intoProfile } from "../windows/windows";
import { samePage } from "../../lib/url";
import { fail, isLockedTab, resolveSpace, sameWindow, spaceWindow, tabIn, unpinnedFolder, unpinnedTabs } from "./spaces";

export type Args = Record<string, unknown>;
export type Change = [BrowserState, Record<string, unknown>];

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

function destinationFolder(s: BrowserState, id: unknown, windowId: string, profileId: string | null): TabGroup | null {
  if (id === undefined || id === null) return null;
  const folder = unpinnedFolder(s, id);
  if (folder.windowId !== windowId) fail(`${folder.id} is in another window`);
  if (profileId && folder.profileId !== profileId) fail(`${folder.id} is in another space`);
  return folder;
}

export function openTab(s: BrowserState, a: Args): Change {
  const url = webUrl(a.url);
  const profileId = resolveSpace(s, a.space);
  const w = spaceWindow(s, profileId);
  const folder = destinationFolder(s, a.folder, w.id, profileId);
  const [opened, id] = withNewTab(s, w.id, { url, profileId, background: optionalFlag(a.background, "background", true) });
  if (!id) fail("The tab couldn't be opened");
  const next = folder ? placing(opened, [id], { pinned: false, groupId: folder.id }) : opened;
  return [next, { opened: id, space: profileId, ...(folder ? { folder: folder.id } : {}) }];
}

export function moveTabs(s: BrowserState, a: Args): Change {
  const tabs = unpinnedTabs(s, a.ids);
  const windowId = sameWindow(tabs);
  const asked = a.space === undefined || a.space === null ? null : resolveSpace(s, a.space);
  const folder = destinationFolder(s, a.folder, windowId, asked);
  const profileId = asked ?? folder?.profileId ?? tabs[0]!.profileId;
  const index = optionalIndex(a.index);
  let next = intoSpace(s, tabs, profileId);
  const ids = tabs.map((t) => t.id);
  const target = folder ? next.groups[folder.id] : undefined;
  if (folder && !target) fail(`${folder.id} is gone`);
  const moving = new Set(ids);
  const destination = (target ? target.tabIds : viewTabIds(next, windowId, profileId).filter((id) => !isLockedTab(next, id))).filter((id) => !moving.has(id));
  const beforeId = index === undefined ? undefined : destination[index];
  next = placing(next, ids, { pinned: false, groupId: target?.id ?? null, ...(beforeId ? { beforeId } : {}) });
  if (ids.some((id) => isLockedTab(next, id))) fail("The move would have pinned a tab");
  return [next, { moved: ids, space: profileId, folder: target?.id ?? null }];
}

export function createFolder(s: BrowserState, a: Args): Change {
  const name = folderName(a.name);
  const tabs = unpinnedTabs(s, a.ids);
  sameWindow(tabs);
  const profileId = a.space === undefined || a.space === null ? tabs[0]!.profileId : resolveSpace(s, a.space);
  const moved = intoSpace(s, tabs, profileId);
  const [next, id] = withGroup(moved, tabs.map((t) => t.id), { name, pinned: false, parentId: null });
  if (!id || next.groups[id]?.pinned) fail("The folder couldn't be made");
  return [next, { folder: id, name, space: profileId, tabs: next.groups[id]!.tabIds }];
}

function newPinned(s: BrowserState, a: Args, row: boolean): Change {
  if ((a.id === undefined) === (a.url === undefined)) fail("Give either id or url");
  let next = s;
  let id: string;
  let url: string;
  if (a.id !== undefined) {
    const tab = tabIn(s, a.id);
    if (isLockedTab(s, tab.id)) fail(`${tab.id} is already pinned or a favorite`);
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

import { tabTitle, activeTabId, viewTabIds } from "../../state/browser/model";
import { knownFaviconTheme, resolveFavicon } from "../../state/favicons/favicons";
import type { BrowserState } from "../../state/browser/store";
import type { GroupColor } from "../../state/browser/types";
import { groupLabel } from "../../state/pins/tabGrouping";
import { splitRowPanes } from "../../state/splits/splits";
import { isSilenced } from "../../state/tabs/mute";
import { errorText } from "../../state/live/engine";
import { awaitsReview, folderRows, hasShownUnread, liveTabPlace, openItems, shownCompleted, shownItems, type FolderRow } from "../../state/live/rows";
import { liveFolderIcon } from "../../state/live/sources";
import type { CompletedItem, CompletionState, LiveFolder, LiveItem } from "../../state/live/types";
import { keptEntry } from "../../state/sidebar/geometry";
import { pointerOnGroup, pointerOnRow } from "../../state/sidebar/hover";
import { folderChildrenWith } from "../../state/sidebar/pinnedTree";
import type { LiveData } from "../../state/sidebar/listCapture";
import { entryKey, parseEntry } from "../../state/sidebar/entryKey";

export type TabShot = { kind: "tab"; key: string; title: string; url: string; favicon?: string | null; icon?: string | null; profileId: string; uri: string | null; template: boolean; sound: "muted" | "playing" | null; hovered: boolean };
export type SplitShot = { kind: "split"; key: string; panes: TabShot[] };
export type LiveItemShot = { key: string; item: LiveItem; indent: number; completing: CompletedItem["state"] | null; done: CompletionState | null; dot: boolean; unread: boolean };
export type LiveRowShot =
  | { kind: "title"; key: string; title: string }
  | { kind: "more"; key: string; count: number }
  | { kind: "stack"; key: string; repo: string; count: number; items: LiveItemShot[] | null }
  | { kind: "item"; key: string; item: LiveItemShot }
  | { kind: "note"; key: string; text: string }
  | { kind: "tab"; key: string; tab: TabShot };
export type LiveShot = {
  kind: "live";
  key: string;
  name: string;
  custom: string | null;
  icon: string | null;
  site: string;
  githubMark: boolean;
  error: string | null;
  updating: boolean;
  unread: boolean;
  count: number;
  collapsed: boolean;
  rows: LiveRowShot[];
};
export type GroupShot = {
  kind: "group";
  key: string;
  label: string;
  color: GroupColor | null;
  icon: { url: string; favicon?: string | null; icon?: string | null; profileId?: string } | null;
  custom: string | null;
  collapsed: boolean;
  hovered: boolean;
  members: EntrySnapshot[];
};
export type EntrySnapshot = TabShot | SplitShot | GroupShot | LiveShot;

function tabShot(s: BrowserState, tabId: string, hovered: boolean): TabShot | null {
  const tab = s.tabs[tabId];
  if (!tab) return null;
  const uri = tab.customIcon ? null : (resolveFavicon(tab.url, tab.favicon, tab.profileId)?.uri ?? null);
  const shape = uri ? knownFaviconTheme(uri) : null;
  return {
    uri,
    template: shape?.kind === "template" && !!shape.stroke,
    kind: "tab",
    key: entryKey("tab", tabId),
    title: tabTitle(tab),
    url: tab.url,
    favicon: tab.favicon,
    icon: tab.customIcon,
    profileId: tab.profileId,
    sound: isSilenced(s, tab) ? "muted" : s.live[tabId]?.playingAudio ? "playing" : null,
    hovered,
  };
}

function splitShot(s: BrowserState, splitId: string): SplitShot {
  const panes = splitRowPanes(s, s.splits[splitId]);
  return { kind: "split", key: entryKey("split", splitId), panes: panes.flatMap((id) => tabShot(s, id, false) ?? []) };
}

export function itemShot(data: LiveData, folderId: string, item: LiveItem, indent: number, done: CompletionState | null = null): LiveItemShot {
  const completing = !done && data.completing[folderId]?.includes(item.id) ? (data.completed[folderId]?.find((c) => c.item.id === item.id)?.state ?? "merged") : null;
  const unread = !done && !!data.unread[folderId]?.includes(item.id);
  return { key: item.id, item, indent, completing, done, dot: unread || (!done && !completing && awaitsReview(item)), unread };
}

function noteText(data: LiveData, folder: LiveFolder): string {
  const status = data.status[folder.id];
  if (!status || status.state === "initializing" || (status.state === "updating" && !status.lastFetch)) return "Loading…";
  if (status.error) return errorText(status.error.kind, status.error.source);
  const hidden = data.hidden[folder.id]?.length ?? 0;
  if (hidden) return `${hidden} hidden until you refresh`;
  return folder.kind === "pullRequests" ? "No open pull requests" : "No recent documents";
}

export function rowShot(data: LiveData, folderId: string, row: FolderRow): LiveRowShot {
  if (row.kind === "header") return { kind: "title", key: row.key, title: row.title };
  if (row.kind === "more") return { kind: "more", key: row.key, count: row.count };
  if (row.kind === "item") return { kind: "item", key: row.key, item: itemShot(data, folderId, row.item, 0, row.done ?? null) };
  const open = data.expandedStacks[row.id] !== false;
  return { kind: "stack", key: row.key, repo: row.repo.split("/")[1] ?? row.repo, count: row.items.length, items: open ? row.items.map((it) => itemShot(data, folderId, it, 10)) : null };
}

function liveShot(s: BrowserState, windowId: string, profileId: string, folderId: string, data: LiveData, peek: boolean): LiveShot | null {
  const folder = data.folders[folderId];
  if (!folder) return null;
  const fetched = data.items[folderId] ?? [];
  const items = shownItems(folder, fetched);
  const completed = shownCompleted(folder, data.completed[folderId] ?? []);
  const rows = folderRows(folder, openItems(items, completed), data.showAll, completed);
  const itemIds = new Set([...items, ...completed.map((c) => c.item)].map((i) => i.id));
  const hiddenIds = new Set([...(data.hidden[folderId] ?? []), ...fetched.filter((it) => !itemIds.has(it.id))].map((item) => item.id));
  const strays = viewTabIds(s, windowId, profileId).filter((id) => s.tabs[id]?.liveItem?.folderId === folderId && liveTabPlace(s.tabs[id]!.liveItem!.itemId, itemIds, hiddenIds) === "stray");
  const all: LiveRowShot[] = rows.length ? rows.map((row) => rowShot(data, folderId, row)) : [{ kind: "note", key: "note", text: noteText(data, folder) }];
  for (const id of strays) {
    const tab = tabShot(s, id, false);
    if (tab) all.push({ kind: "tab", key: `stray:${id}`, tab });
  }
  const collapsed = folder.collapsed || peek;
  const status = data.status[folderId];
  const initialLoading = !status || status.state === "initializing" || (status.state === "updating" && !status.lastFetch);
  const active = activeTabId(s, windowId, profileId);
  const activeItem = active && s.tabs[active]?.liveItem?.folderId === folderId ? s.tabs[active]!.liveItem!.itemId : null;
  const keep = !activeItem
    ? null
    : strays.includes(active!)
      ? `stray:${active}`
      : (rows.find((r) => (r.kind === "item" && r.item.id === activeItem) || (r.kind === "stack" && r.items.some((i) => i.id === activeItem)))?.key ?? null);
  return {
    kind: "live",
    key: entryKey("live", folderId),
    name: folder.name,
    custom: folder.icon,
    icon: liveFolderIcon(folder).icon,
    site: liveFolderIcon(folder).site,
    githubMark: folder.sources[0] === "github" && !initialLoading,
    error: status?.error ? errorText(status.error.kind, status.error.source) : null,
    updating: status?.state === "updating" || status?.state === "initializing",
    unread: hasShownUnread(folder, fetched, data.unread[folderId]),
    count: items.length,
    collapsed,
    rows: collapsed ? all.filter((r) => r.key === keep) : all,
  };
}

function groupShot(s: BrowserState, windowId: string, profileId: string, groupId: string, data: LiveData, peek: boolean): GroupShot | null {
  const group = s.groups[groupId];
  if (!group) return null;
  const entries = folderChildrenWith(s, windowId, profileId, groupId, data.folders);
  const collapsed = !!group.collapsed || peek;
  const kept = collapsed ? keptEntry(s, windowId, profileId, entries) : null;
  const first = s.tabs[group.tabIds[0] ?? ""];
  return {
    kind: "group",
    key: entryKey("group", groupId),
    label: groupLabel(s, group),
    color: group.color ?? null,
    icon: group.icon || first ? { url: first?.url ?? "", favicon: first?.favicon, icon: group.icon ?? first?.customIcon, profileId: first?.profileId } : null,
    custom: group.icon ?? null,
    collapsed,
    hovered: pointerOnGroup(groupId),
    members: (collapsed ? (kept ? [kept] : []) : entries).flatMap((e) => memberShot(s, windowId, profileId, e, data, collapsed) ?? []),
  };
}

function memberShot(s: BrowserState, windowId: string, profileId: string, entry: string, data: LiveData, peek: boolean): EntrySnapshot | null {
  const { kind, id } = parseEntry(entry);
  if (kind === "split") return splitShot(s, id);
  if (kind === "group") return groupShot(s, windowId, profileId, id, data, peek);
  if (kind === "live") return liveShot(s, windowId, profileId, id, data, peek);
  return tabShot(s, id, false);
}

export function snapshotEntry(s: BrowserState, windowId: string, profileId: string, entry: string, data: LiveData): EntrySnapshot | null {
  const { kind, id } = parseEntry(entry);
  if (kind === "tab") return tabShot(s, id, pointerOnRow(id));
  return memberShot(s, windowId, profileId, entry, data, false);
}

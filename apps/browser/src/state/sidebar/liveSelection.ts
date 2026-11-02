import { cleanUrl, markdownLink } from "@ardia/core";
import { copyText } from "../../platform/clipboard";
import { showMenu } from "../../platform/menus";
import { useBrowser, type BrowserState } from "../browser/store";
import { activeTabId, plural, tabTitle, viewTabIds } from "../browser/model";
import type { ClickMods } from "../drag/drops";
import { openLiveItem } from "../live/engine";
import { folderRows, openItems, shownCompleted, shownItems } from "../live/rows";
import { live } from "../live/store";
import type { LiveItem } from "../live/types";
import { selectedTabIds } from "../pins/organize";
import { isLiveRowKey, liveRowKey } from "./liveRowKey";
import { sections, withAlternate } from "./menuParts";

type LiveEntry = { kind: "live"; key: string; folderId: string; item: LiveItem; tabId: string | null };
type TabEntry = { kind: "tab"; id: string; url: string; title: string };
type Entry = LiveEntry | TabEntry;

const store = () => useBrowser.getState();

function folderOrder(folderId: string): { key: string; item: LiveItem }[] {
  const l = live();
  const folder = l.folders[folderId];
  if (!folder) return [];
  const completed = shownCompleted(folder, l.completed[folderId] ?? []);
  const rows = folderRows(folder, openItems(shownItems(folder, l.items[folderId] ?? []), completed), l.showAll, completed);
  return rows.flatMap((row) => {
    if (row.kind === "item") return [row.item];
    if (row.kind === "stack" && l.expandedStacks[row.id] !== false) return row.items;
    return [];
  }).map((item) => ({ key: liveRowKey(folderId, item.id), item }));
}

const itemTab = (s: BrowserState, windowId: string, folderId: string, itemId: string) =>
  viewTabIds(s, windowId).find((id) => s.tabs[id]?.liveItem?.folderId === folderId && s.tabs[id]?.liveItem?.itemId === itemId) ?? null;

function selectedEntries(s: BrowserState, windowId: string): Entry[] {
  const chosen = new Set(s.selection[windowId] ?? []);
  const rows: Entry[] = live().folderOrder.flatMap((folderId) =>
    folderOrder(folderId)
      .filter((r) => chosen.has(r.key))
      .map((r) => ({ kind: "live" as const, key: r.key, folderId, item: r.item, tabId: itemTab(s, windowId, folderId, r.item.id) })),
  );
  const tabs: Entry[] = (s.selection[windowId] ?? []).some((id) => !isLiveRowKey(id))
    ? selectedTabIds(s, windowId).flatMap((id) => {
        const t = s.tabs[id];
        return chosen.has(id) && t?.url ? [{ kind: "tab" as const, id, url: t.url, title: tabTitle(t) }] : [];
      })
    : [];
  return [...rows, ...tabs];
}

const entryId = (e: Entry) => (e.kind === "live" ? e.key : e.id);

export function liveSelectionIncludes(windowId: string, id: string): boolean {
  const s = store();
  if (!(s.selection[windowId] ?? []).some(isLiveRowKey)) return false;
  const entries = selectedEntries(s, windowId);
  return entries.length > 1 && entries.some((e) => entryId(e) === id);
}

function activeLiveKey(s: BrowserState, windowId: string, folderId: string): string | null {
  const ref = s.tabs[activeTabId(s, windowId) ?? ""]?.liveItem;
  return ref?.folderId === folderId ? liveRowKey(folderId, ref.itemId) : null;
}

export function clickLiveItem(windowId: string, folderId: string, item: LiveItem, mods: ClickMods = {}) {
  const s = store();
  const key = liveRowKey(folderId, item.id);
  const current = s.selection[windowId] ?? [];
  if (mods.metaKey) {
    const base = current.length ? current : [activeLiveKey(s, windowId, folderId)].filter((k): k is string => !!k);
    return s.setSelection(windowId, base.includes(key) ? base.filter((id) => id !== key) : [...base, key], key);
  }
  if (mods.shiftKey) {
    const order = folderOrder(folderId).map((r) => r.key);
    const anchor = s.selectionAnchors[windowId];
    const fromKey = anchor && order.includes(anchor) ? anchor : activeLiveKey(s, windowId, folderId);
    const from = fromKey ? order.indexOf(fromKey) : -1;
    const to = order.indexOf(key);
    if (from >= 0 && to >= 0) return s.setSelection(windowId, order.slice(Math.min(from, to), Math.max(from, to) + 1));
    return s.setSelection(windowId, current.includes(key) ? current : [...current, key], key);
  }
  s.setSelection(windowId, [], key);
  openLiveItem(windowId, folderId, item);
}

function copyEntries(entries: Entry[], markdown: boolean) {
  const lines = entries.map((e) => {
    const url = e.kind === "live" ? e.item.url : e.url;
    const title = e.kind === "live" ? e.item.title : e.title;
    return markdown ? markdownLink(title, url) : cleanUrl(url);
  });
  if (lines.length) copyText(markdown && lines.length > 1 ? lines.map((l) => `- ${l}`).join("\n") : lines.join("\n"));
}

export function liveSelectionMenuItems(entries: Entry[]) {
  const n = entries.length;
  const unopened = entries.filter((e) => e.kind === "live" && !e.tabId).length;
  const open = entries.filter((e) => e.kind === "tab" || e.tabId).length;
  return sections(
    unopened ? [{ id: "open", title: unopened === 1 ? "Open in New Tab" : `Open ${unopened} in New Tabs`, symbol: "arrow.up.forward.square" }] : [],
    withAlternate({ id: "copy", title: `Copy ${n} Links`, symbol: "link" }, { id: "copyMd", title: `Copy ${n} Links as Markdown`, symbol: "link" }, null),
    open ? [{ id: "close", title: `Close ${plural(open, "Tab")}`, symbol: "xmark" }] : [],
  );
}

export async function openLiveSelectionMenu(windowId: string) {
  const entries = selectedEntries(store(), windowId);
  const choice = await showMenu(liveSelectionMenuItems(entries));
  if (!choice) return;
  if (choice === "copy" || choice === "copyMd") return copyEntries(entries, choice === "copyMd");
  const s = store();
  if (choice === "open") {
    for (const e of entries) if (e.kind === "live" && !itemTab(s, windowId, e.folderId, e.item.id)) openLiveItem(windowId, e.folderId, e.item, { background: true });
  } else if (choice === "close") {
    const tabs = entries.flatMap((e) => (e.kind === "tab" ? [e.id] : e.tabId ? [e.tabId] : [])).filter((id) => s.tabs[id]?.windowId === windowId);
    if (tabs.length) s.closeTabs(tabs);
  }
  store().setSelection(windowId, []);
}

import { cleanUrl, markdownLink } from "@ardia/core";
import { copyText, prompt } from "@ardia/shell";
import { updateFolder } from "../../live/store";
import { useBrowser } from "../../store/browser";
import { ancestorIds } from "../../store/groups";
import { activeTabId, bookmarkProfileId, pinSection, tabLayoutOf, viewTabIds } from "../../store/model";
import { groupLabel, groupOf, selectedTabIds } from "../../store/organize";
import type { Tab } from "../../store/types";
import { FOLD_MS } from "./geometry";
import { containersOf, hiddenBy, type PathTarget } from "./pinnedTree";
import { measureRow, revealInSidebar, setSidebarUi, sidebarUi, type Target } from "./state";

const store = () => useBrowser.getState();

const anchors = new Map<string, string>();

const rangeOrder = (s: ReturnType<typeof store>, windowId: string) =>
  viewTabIds(s, windowId).filter((id) => {
    const t = s.tabs[id]!;
    return !t.liveItem || t.pinned;
  });

export function clickTab(windowId: string, tabId: string, mods: { metaKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {}) {
  const s = store();
  if (mods.altKey && mods.shiftKey && !mods.metaKey && s.settings.optShiftClickOpensInGroup) return openInCurrentGroup(windowId, tabId);
  const view = rangeOrder(s, windowId);
  const active = activeTabId(s, windowId);
  const current = s.selection[windowId] ?? [];
  if (mods.metaKey) {
    const base = current.length ? current : active ? [active] : [];
    const next = base.includes(tabId) ? base.filter((id) => id !== tabId) : [...base, tabId];
    anchors.set(windowId, tabId);
    return s.setSelection(windowId, next.length > 1 ? next : []);
  }
  if (mods.shiftKey) {
    const from = view.indexOf(anchors.get(windowId) ?? active ?? tabId);
    const to = view.indexOf(tabId);
    if (from >= 0 && to >= 0) {
      const [a, b] = from < to ? [from, to] : [to, from];
      return s.setSelection(windowId, view.slice(a, b + 1));
    }
  }
  anchors.set(windowId, tabId);
  s.setSelection(windowId, []);
  s.activate(tabId);
}

function openInCurrentGroup(windowId: string, tabId: string) {
  const s = store();
  const active = activeTabId(s, windowId);
  if (active && active !== tabId && !s.tabs[tabId]?.pinned && !s.tabs[active]?.pinned) {
    const group = groupOf(s, active);
    if (group) s.addTabsToGroup(group.id, [tabId]);
    else s.groupTabs([active, tabId]);
  }
  anchors.set(windowId, tabId);
  store().setSelection(windowId, []);
  store().activate(tabId);
}

const profileOf = (windowId: string, target: PathTarget) => {
  const s = store();
  return (target.kind === "tab" ? s.tabs[target.id]?.profileId : target.kind === "group" ? s.groups[target.id]?.profileId : undefined) ?? s.windows[windowId]?.profileId;
};

const targetContainers = (windowId: string, profileId: string, target: PathTarget) => {
  const s = store();
  return target.kind === "group" && !s.groups[target.id]?.pinned ? ancestorIds(s.groups, target.id) : containersOf(s, windowId, profileId, target);
};

function expandHidden(windowId: string, target: PathTarget): boolean {
  const profileId = profileOf(windowId, target);
  if (!profileId) return false;
  const hidden = target.kind === "group" ? targetContainers(windowId, profileId, target).filter((id) => store().groups[id]?.collapsed) : hiddenBy(store(), windowId, profileId, target);
  for (const id of hidden) store().updateGroup(id, { collapsed: false });
  return hidden.length > 0;
}

export function openPath(windowId: string, target: PathTarget) {
  const profileId = profileOf(windowId, target);
  if (!profileId) return;
  const s = store();
  for (const id of targetContainers(windowId, profileId, target)) if (s.groups[id]?.collapsed) store().updateGroup(id, { collapsed: false });
}

const settled = (expanded: boolean) => new Promise((resolve) => setTimeout(resolve, expanded ? FOLD_MS + 50 : 0));

export async function startRename(windowId: string, target: Target) {
  const s = store();
  if (target.kind === "tab") {
    const tab = s.tabs[target.id];
    if (!tab) return;
    if (tab.pinned && !tab.pinnedAsRow) {
      const name = await prompt({
        title: "Rename Tab",
        value: tab.customTitle ?? tab.title,
        placeholder: tab.title || "Tab name",
        confirmTitle: "Update",
        windowId,
      });
      if (name !== null) store().updateTab(tab.id, { customTitle: name });
      return;
    }
  }
  if (target.kind === "group" && !sidebarShows(windowId)) return renameGroupInSheet(windowId, target.id);
  const expanded = target.kind === "live" || target.kind === "folder" ? false : expandHidden(windowId, { kind: target.kind, id: target.id });
  setSidebarUi({ renaming: { windowId, ...target } });
  if (target.kind === "live" || !sidebarShows(windowId)) return;
  await settled(expanded);
  revealInSidebar(windowId, target.id);
}

const sidebarShows = (windowId: string) => tabLayoutOf(store(), windowId) === "sidebar" && !!store().windows[windowId]?.sidebarOpen;

async function renameGroupInSheet(windowId: string, groupId: string) {
  const g = store().groups[groupId];
  if (!g) return;
  const name = await prompt({
    title: "Rename Group",
    value: g.name,
    placeholder: groupLabel(store(), g),
    confirmTitle: "Update",
    windowId,
  });
  if (name !== null && store().groups[groupId]) store().updateGroup(groupId, { name: name.trim() });
}

export function commitRename(target: Target, text: string) {
  const name = text.trim();
  if (target.kind === "tab") {
    const tab = store().tabs[target.id];
    if (tab) store().updateTab(tab.id, { customTitle: name && name !== tab.title ? name : null });
  } else store().updateGroup(target.id, { name });
  endRename(target);
}

export function endRename(target: Target) {
  const r = sidebarUi().renaming;
  if (r && r.id === target.id) setSidebarUi({ renaming: null });
}

export async function openIconPicker(windowId: string, target: Target) {
  if (target.kind !== "live" && target.kind !== "folder") await settled(expandHidden(windowId, { kind: target.kind, id: target.id }));
  const anchor = await measureRow(windowId, target.id);
  setSidebarUi({ iconPicker: { windowId, ...target, anchor }, hover: null });
}

export function setIcon(target: Target, icon: string | null) {
  if (target.kind === "tab") store().updateTab(target.id, { customIcon: icon });
  else if (target.kind === "live") updateFolder(target.id.split("|")[1] ?? "", { icon });
  else store().updateGroup(target.id, { icon });
}

export function newGroupWithSelection(windowId: string, ids = selectedTabIds(store(), windowId)) {
  const groupId = store().groupTabs(ids.filter((id) => pinSection(store().tabs[id]) !== "tile"));
  if (groupId && sidebarShows(windowId)) void startRename(windowId, { kind: "group", id: groupId });
  return groupId;
}

const urlLabel = (url: string) => url.replace(/^[a-z][\w+.-]*:\/\//i, "").replace(/^www\./, "").replace(/\/$/, "");
export const tabTitle = (t: Pick<Tab, "customTitle" | "title" | "url">) => t.customTitle || t.title || (t.url && urlLabel(t.url)) || "New Tab";

export function copyUrls(ids: string[], markdown: boolean) {
  const tabs = ids.map((id) => store().tabs[id]).filter((t): t is Tab => !!t?.url);
  if (!tabs.length) return;
  const lines = tabs.map((t) => (markdown ? markdownLink(tabTitle(t), t.url) : cleanUrl(t.url)));
  copyText(markdown && lines.length > 1 ? lines.map((l) => `- ${l}`).join("\n") : lines.join("\n"));
}

export async function bookmarkTabs(windowId: string, ids: string[], folder: string | "bar" | "new") {
  const s = store();
  const profileId = bookmarkProfileId(s, s.windows[windowId]);
  let parentId: string | undefined = folder === "bar" ? undefined : folder;
  if (folder === "new") {
    const title = await prompt({ title: "New Folder", placeholder: "Folder name", confirmTitle: "Create", windowId });
    if (!title) return;
    parentId = store().addBookmarkFolder({ profileId, title });
  }
  for (const id of ids) {
    const t = store().tabs[id];
    if (t?.url) store().addBookmark({ profileId, url: t.url, title: tabTitle(t), favicon: t.favicon, parentId });
  }
}

export async function editPinnedPage(windowId: string, tabId: string) {
  const tab = store().tabs[tabId];
  if (!tab?.pinned) return;
  const url = await prompt({
    title: "Edit Pinned Page",
    value: tab.pinnedUrl ?? tab.url,
    placeholder: "Enter Pinned URL",
    confirmTitle: "Save",
    windowId,
  });
  if (url) store().setPinnedUrl(tabId, url.includes("://") ? url : `https://${url}`);
}

export function muteAll(windowId: string, muted: boolean) {
  store().setMuted(viewTabIds(store(), windowId), muted);
}

export const allMuted = (windowId: string) => {
  const s = store();
  const view = viewTabIds(s, windowId).filter((id) => s.tabs[id]!.url);
  return view.length > 0 && view.every((id) => s.tabs[id]!.muted);
};

import { cleanUrl, markdownLink } from "@ardia/core";
import type { ImageRequireSource } from "react-native";
import { copyText } from "../../platform/clipboard";
import { prompt } from "../../platform/dialogs";
import { showMenu, type MenuItem } from "../../platform/menus";
import { closeTab } from "../browser/actions";
import { calendarConnected, connectCalendar, setCalendarHidden, useCalendar } from "../live/calendar";
import { deleteLiveFolder, manualRefresh, newLiveFolder, openLiveItem, refreshFolder, statusText } from "../live/engine";
import { ALERT_LEADS, nowBadgeEvent } from "../live/meetings";
import { folderRepos, shownItems } from "../live/rows";
import { SOURCES } from "../live/sources";
import { dismissNowBadge, hideItems, live, markRead, markUnread, moveFolderToProfile, updateCalendarSettings, updateFolder } from "../live/store";
import type { LiveItem, LiveSourceId } from "../live/types";
import { useBrowser } from "../browser/store";
import { openSettings } from "../settings/settingsWindows";
import { openIconPicker } from "../sidebar/actions";
import { liveNode } from "../pins/pinTree";
import { addressBarInSidebar } from "../windows/layout";
import { activeTabId } from "../browser/model";
import { hintWhen, sections, sep, withAlternate } from "./menuParts";
import { liveRowKey } from "./liveRowKey";
import { liveSelectionIncludes, openLiveSelectionMenu } from "./liveSelection";

export function newLiveFolderMenuItem(): MenuItem {
  return {
    id: "live",
    title: "New Live Folder",
    children: [
      { id: "live:pullRequests", title: "Pull Requests", symbol: "arrow.triangle.pull" },
      { id: "live:documents", title: "Documents", symbol: "doc.text" },
    ],
  };
}

export function removeLiveFolder(folderId: string) {
  const profileId = live().folders[folderId]?.profileId;
  deleteLiveFolder(folderId);
  if (profileId) useBrowser.getState().dropPinned(profileId, [liveNode(folderId)]);
}

function moveLiveFolderToProfile(folderId: string, profileId: string) {
  const from = live().folders[folderId]?.profileId;
  if (!from || from === profileId) return;
  const s = useBrowser.getState();
  for (const t of Object.values(s.tabs)) if (t.liveItem?.folderId === folderId) s.updateTab(t.id, { liveItem: undefined });
  s.dropPinned(from, [liveNode(folderId)]);
  moveFolderToProfile(folderId, profileId);
  useBrowser.getState().placePinned(profileId, [liveNode(folderId)], null);
}

const githubMark = () => (require("react-native") as typeof import("react-native")).Image.resolveAssetSource(require("../../../assets/site-icons/github.png") as ImageRequireSource).uri;

export function runNewLiveFolder(windowId: string, choice: string): boolean {
  if (choice === "live:pullRequests") newLiveFolder(windowId, "pullRequests");
  else if (choice === "live:documents") newLiveFolder(windowId, "documents");
  else return false;
  return true;
}

const SOURCE_GROUPS: Record<"pullRequests" | "documents", LiveSourceId[]> = {
  pullRequests: ["github", "bitbucket"],
  documents: ["notion", "confluence", "gdrive"],
};

const FILTERS = [
  { key: "authored", title: "Created by Me" },
  { key: "reviewRequests", title: "Review Requests" },
  { key: "teamReviewRequests", title: "Team Review Requests" },
] as const;

export async function openLiveFolderMenu(windowId: string, folderId: string) {
  const s = live();
  const folder = s.folders[folderId];
  if (!folder) return;
  const browser = useBrowser.getState();
  const pr = folder.kind === "pullRequests";
  const status = s.status[folderId];
  const repos = folderRepos(folder, [...(s.items[folderId] ?? []), ...(s.hidden[folderId] ?? [])]);
  const sourceItems: MenuItem[] = SOURCE_GROUPS[folder.kind].map((id) => ({
    id: `source:${id}`,
    title: s.accounts[id] ? SOURCES[id].name : `${SOURCES[id].name} (Not Connected)`,
    checked: folder.sources.includes(id),
  }));
  const choice = await showMenu([
    {
      id: "fetch",
      title: pr ? "Pull Requests" : "Documents",
      ...(folder.sources[0] === "github" ? { image: githubMark() } : { symbol: pr ? "arrow.triangle.pull" : "doc.text" }),
      children: [
        { id: "status", title: statusText(folderId), enabled: false },
        { id: "refresh", title: "Refresh", enabled: status?.state !== "updating" },
        sep,
        ...(pr
          ? [
              ...FILTERS.map((f) => ({ id: `filter:${f.key}`, title: f.title, checked: folder.filters[f.key] })),
              { id: "showCompleted", title: "Show Completed", checked: folder.showCompleted },
              sep,
              {
                id: "repos",
                title: "Repositories",
                children: [
                  ...repos.map((repo) => ({ id: `repo:${repo}`, title: repo, checked: !folder.hiddenRepos.includes(repo) })),
                  ...(repos.length ? [sep] : []),
                  { id: "reposNote", title: "This list is generated based on your currently active pull requests.", enabled: false },
                ],
              },
              ...(s.accounts.bitbucket ? [sep, ...sourceItems] : []),
            ]
          : sourceItems),
      ],
    },
    {
      id: "moveTo",
      title: "Move to",
      children: browser.profileOrder.map((id) => ({ id: `profile:${id}`, title: browser.profiles[id]!.name, checked: id === folder.profileId, enabled: id !== folder.profileId })),
    },
    { id: "copy", title: "Copy All Links" },
    sep,
    { id: "icon", title: folder.icon || addressBarInSidebar(browser, windowId) ? "Change Icon…" : "Add Icon…" },
    { id: "rename", title: "Rename…" },
    sep,
    { id: "delete", title: "Delete Live Folder" },
  ]);
  if (!choice) return;
  const filter = FILTERS.find((f) => choice === `filter:${f.key}`);
  if (choice === "refresh") void manualRefresh(folderId);
  else if (filter) {
    updateFolder(folderId, { filters: { ...folder.filters, [filter.key]: !folder.filters[filter.key] } });
    void refreshFolder(folderId);
  } else if (choice === "showCompleted") updateFolder(folderId, { showCompleted: !folder.showCompleted });
  else if (choice.startsWith("repo:")) {
    const repo = choice.slice(5);
    updateFolder(folderId, { hiddenRepos: folder.hiddenRepos.includes(repo) ? folder.hiddenRepos.filter((r) => r !== repo) : [...folder.hiddenRepos, repo] });
  } else if (choice.startsWith("source:")) {
    const id = choice.slice(7) as LiveSourceId;
    if (!live().accounts[id]) return openSettings("liveFolders");
    const sources = folder.sources.includes(id) ? folder.sources.filter((x) => x !== id) : [...folder.sources, id];
    updateFolder(folderId, { sources: sources.length ? sources : folder.sources });
    void refreshFolder(folderId);
  } else if (choice.startsWith("profile:")) moveLiveFolderToProfile(folderId, choice.slice(8));
  else if (choice === "copy") {
    const urls = shownItems(folder, live().items[folderId] ?? []).map((it) => cleanUrl(it.url));
    if (urls.length) copyText(urls.join("\n"));
  } else if (choice === "rename") {
    const name = await prompt({ title: "Rename Live Folder", value: folder.name, placeholder: "Live folder name", confirmTitle: "Rename", windowId });
    if (name?.trim()) updateFolder(folderId, { name: name.trim() });
  } else if (choice === "icon") void openIconPicker(windowId, { kind: "live", id: `livefolder|${folderId}` });
  else if (choice === "delete") removeLiveFolder(folderId);
}

export function liveItemMenuItems(windowId: string, folderId: string, item: LiveItem, tabId: string | null): MenuItem[] {
  const unread = !!live().unread[folderId]?.includes(item.id);
  const shown = !!tabId && activeTabId(useBrowser.getState(), windowId) === tabId;
  return sections(
    [
      { id: "open", title: tabId ? "Show Tab" : "Open", symbol: "arrow.up.forward.square" },
      { id: "background", title: "Open in Background", enabled: !tabId },
    ],
    withAlternate({ id: "copy", title: "Copy Link", symbol: "link" }, { id: "copyMd", title: "Copy Link as Markdown", symbol: "link" }, null),
    [
      { id: "unread", title: unread ? "Mark as Read" : "Mark as Unread", symbol: unread ? "circle" : "circle.fill" },
      ...(item.pr ? [{ id: "hide", title: "Hide Until Refresh", symbol: "eye.slash" }] : []),
    ],
    tabId ? [{ id: "close", title: "Close", symbol: "xmark", ...hintWhen(shown, "closeTab") }] : [],
  );
}

export async function openLiveItemMenu(windowId: string, folderId: string, item: LiveItem, tabId: string | null) {
  if (liveSelectionIncludes(windowId, liveRowKey(folderId, item.id))) return openLiveSelectionMenu(windowId);
  if (useBrowser.getState().selection[windowId]?.length) useBrowser.getState().setSelection(windowId, []);
  const unread = !!live().unread[folderId]?.includes(item.id);
  const choice = await showMenu(liveItemMenuItems(windowId, folderId, item, tabId));
  if (choice === "open") openLiveItem(windowId, folderId, item);
  else if (choice === "background") openLiveItem(windowId, folderId, item, { background: true });
  else if (choice === "copy") copyText(cleanUrl(item.url));
  else if (choice === "copyMd") copyText(markdownLink(item.title, item.url));
  else if (choice === "unread") {
    if (unread) markRead(folderId, [item.id]);
    else markUnread(folderId, item.id);
  } else if (choice === "hide") hideItems(folderId, [item]);
  else if (choice === "close" && tabId) void closeTab(tabId);
}

export async function openLiveStackMenu(folderId: string, stackId: string) {
  const choice = await showMenu([{ id: "hide", title: "Hide Stack Until Refresh", symbol: "eye.slash" }]);
  if (choice === "hide") hideItems(folderId, (live().items[folderId] ?? []).filter((it) => it.pr?.stack?.id === stackId));
}

const DISMISS_NOW = "cal:dismissNow:";

export function dismissNowMenuItems(now = Date.now()): MenuItem[] {
  const { calendar, dismissedNow } = live();
  if (!calendar.showTimeToNext) return [];
  const event = nowBadgeEvent(useCalendar.getState().events, now, dismissedNow);
  return event ? [{ id: `${DISMISS_NOW}${event.occurrence}`, title: `Hide “Now” for ${event.title || "This Meeting"}`, symbol: "eye.slash" }] : [];
}

export function calendarMenuItem(): MenuItem {
  const settings = live().calendar;
  const { calendars } = useCalendar.getState();
  const owned = calendars.filter((c) => c.owned);
  const others = calendars.filter((c) => !c.owned);
  const hidden = new Set(settings.hiddenCalendarIds);
  const calendarItems = (list: typeof calendars): MenuItem[] => list.map((c) => ({ id: `cal:toggle:${c.id}`, title: c.title, swatch: c.color, checked: !hidden.has(c.id) }));
  return {
    id: "cal",
    title: "Calendar",
    symbol: "calendar",
    children: [
      ...(calendarConnected() ? [] : [{ id: "cal:connect", title: "Connect Calendar…", symbol: "calendar.badge.plus" }, sep]),
      {
        id: "cal:alerts",
        title: "Show Next Meeting Alert",
        children: ALERT_LEADS.map((l) => ({ id: `cal:lead:${l.value}`, title: l.title, checked: settings.alertLead === l.value })),
      },
      { id: "cal:preview", title: "Show Calendar Preview", checked: settings.showPreview },
      { id: "cal:badge", title: "Show Time to Next Meeting", checked: settings.showTimeToNext },
      {
        id: "cal:active",
        title: "Active Calendars",
        enabled: calendars.length > 0,
        children: [
          ...(owned.length ? [{ id: "cal:h1", title: "My Calendars", enabled: false }, ...calendarItems(owned)] : []),
          ...(others.length ? [sep, { id: "cal:h2", title: "Other Calendars", enabled: false }, ...calendarItems(others)] : []),
        ],
      },
      sep,
      { id: "cal:settings", title: "Calendar Settings…", symbol: "gearshape" },
    ],
  };
}

export function runCalendarMenu(choice: string): boolean {
  if (!choice.startsWith("cal:")) return false;
  const settings = live().calendar;
  if (choice.startsWith(DISMISS_NOW)) {
    const event = useCalendar.getState().events.find((e) => e.occurrence === choice.slice(DISMISS_NOW.length));
    if (event) dismissNowBadge(event);
  } else if (choice === "cal:connect") void connectCalendar();
  else if (choice.startsWith("cal:lead:")) updateCalendarSettings({ alertLead: choice.slice(9) });
  else if (choice === "cal:preview") updateCalendarSettings({ showPreview: !settings.showPreview });
  else if (choice === "cal:badge") updateCalendarSettings({ showTimeToNext: !settings.showTimeToNext });
  else if (choice.startsWith("cal:toggle:")) {
    const id = choice.slice(11);
    setCalendarHidden(id, !settings.hiddenCalendarIds.includes(id));
  } else if (choice === "cal:settings") openSettings("calendar");
  return true;
}

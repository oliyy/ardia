import { chooseFromMenu, type ChoiceItem } from "../app/menuChoice";
import { closeTab, moveTabsToProfile, toggleMute } from "../browser/actions";
import { useBrowser, type BrowserState } from "../browser/store";
import { activeTabId, inPinnedContainer, isIncognitoProfile, pinSection, viewTabIds } from "../browser/model";
import type { Tab } from "../browser/types";
import { awayFromPin } from "../pins/organize";
import { splitOf } from "../splits/splits";
import { openInSplit, openSplitPane } from "../splits/actions";
import { canShare, shareTab } from "../site/share";
import { togglePageEngine } from "../engines/actions";
import { canSwitchEngine, ENGINE_NAMES, otherEngine, tabEngine } from "../engines/engines";
import { menuShortcut } from "../commands/commandShortcuts";
import { isCalendarUrl } from "../live/meetings";
import { copyUrls, editPinnedPage, newGroupWithSelection, openIconPicker, startRename } from "./actions";
import { calendarMenuItem, runCalendarMenu } from "./liveMenus";
import { sep, withAlternate } from "./menuParts";

type SpaceChoice = { kind: "space"; profileId: string };
type ArcMenuItem = ChoiceItem<SpaceChoice>;
type Neighbours = { others: string[]; above: string[]; below: string[] };

const store = () => useBrowser.getState();
const SHARE_VIA = "share:via:";

function spaceItems(s: BrowserState, profileId: string): ArcMenuItem[] {
  return s.profileOrder.flatMap((id) => {
    const profile = s.profiles[id];
    return profile ? [{ value: { kind: "space" as const, profileId: id }, title: profile.name, checked: id === profileId, enabled: id !== profileId }] : [];
  });
}

function engineItem(s: BrowserState, tab: Tab): ArcMenuItem[] {
  if (!canSwitchEngine(tab.url)) return [];
  return [{ id: "engine", title: `Open Page in ${ENGINE_NAMES[otherEngine(tabEngine(s, tab.id))]}` }];
}

const copyItems = (s: BrowserState, plural: boolean, enabled = true): ArcMenuItem[] =>
  withAlternate(
    { id: "copy", title: plural ? "Copy Links" : "Copy Link", enabled },
    { id: "copyMd", title: plural ? "Copy Links as Markdown" : "Copy Link as Markdown", enabled },
    ["copyUrl", "copyUrlAsMarkdown"],
    s,
  );

export async function openArcTabMenu(windowId: string, tab: Tab) {
  const s = store();
  const list = viewTabIds(s, windowId).filter((id) => !inPinnedContainer(s, id));
  const index = list.indexOf(tab.id);
  const pinned = inPinnedContainer(s, tab.id);
  const active = activeTabId(s, windowId) === tab.id;
  const playing = !!s.live[tab.id]?.playingAudio;
  const split = splitOf(s, tab.id);
  const neighbours: Neighbours = pinned
    ? { others: [], above: [], below: [] }
    : { others: list.filter((id) => id !== tab.id), above: list.slice(0, index), below: list.slice(index + 1) };
  const choice = await chooseFromMenu<SpaceChoice, string>([
    ...(tab.pin && isCalendarUrl(tab.pinnedUrl ?? tab.url) ? [calendarMenuItem(), sep] : []),
    ...copyItems(s, false, !!tab.url),
    { id: "share", title: "Share", enabled: canShare(tab), share: true },
    sep,
    { id: "icon", title: "Change Icon…" },
    { id: "rename", title: "Rename…" },
    { id: "mute", title: tab.muted ? "Unmute" : "Mute", enabled: tab.muted || playing },
    ...engineItem(s, tab),
    ...(tab.pin
      ? [{ id: "editPinned", title: "Edit Pinned Page", children: [{ id: "editPin", title: "Edit…" }, { id: "replacePin", title: "Replace Pinned URL with Current", enabled: awayFromPin(tab) }] }]
      : []),
    sep,
    split ? { id: "unsplit", title: "Separate from Split View" } : { id: "split", title: active ? "Add Split View" : "Open in Split View" },
    { id: "duplicate", title: "Duplicate" },
    { id: "moveTo", title: "Move to", enabled: !isIncognitoProfile(tab.profileId), children: spaceItems(s, tab.profileId) },
    sep,
    ...(pinned
      ? [{ id: "unpin", title: pinSection(tab) === "tile" ? "Remove Favorite" : "Remove Pin" }]
      : [
          { id: "close", title: "Close Tab", ...menuShortcut("closeTab", s) },
          { id: "archive", title: "Archive Tab" },
          { id: "closeOthers", title: "Archive Other Tabs", enabled: neighbours.others.length > 0 },
          { id: "closeBelow", title: "Archive Tabs Below", enabled: neighbours.below.length > 0 },
          { id: "closeAbove", title: "Archive Tabs Above", enabled: neighbours.above.length > 0 },
        ]),
  ]);
  const now = store().tabs[tab.id];
  if (!choice || now?.windowId !== windowId) return;
  if (typeof choice !== "string") return void moveTabsToProfile([tab.id], choice.profileId);
  runArcTabChoice(windowId, now, choice, neighbours, active);
}

function runArcTabChoice(windowId: string, tab: Tab, choice: string, { others, above, below }: Neighbours, active: boolean) {
  const s = store();
  const t = { kind: "tab" as const, id: tab.id };
  if (runCalendarMenu(choice)) return;
  if (choice.startsWith(SHARE_VIA)) void shareTab(tab, windowId, choice.slice(SHARE_VIA.length));
  else if (choice === "copy") copyUrls([tab.id], false);
  else if (choice === "copyMd") copyUrls([tab.id], true);
  else if (choice === "icon") void openIconPicker(windowId, t);
  else if (choice === "rename") void startRename(windowId, t);
  else if (choice === "mute") toggleMute(tab.id);
  else if (choice === "engine") void togglePageEngine(tab.id);
  else if (choice === "editPin") void editPinnedPage(windowId, tab.id);
  else if (choice === "replacePin") s.setPinnedUrl(tab.id);
  else if (choice === "unsplit") s.removeTabFromSplit(tab.id);
  else if (choice === "split") void (active ? openSplitPane(windowId, { anchorTabId: tab.id }) : openInSplit(tab.id));
  else if (choice === "duplicate") s.duplicateTab(tab.id);
  else if (choice === "unpin") s.pinTabs([tab.id], false);
  else if (choice === "close" || choice === "archive") void closeTab(tab.id);
  else if (choice === "closeOthers") s.closeTabs(others);
  else if (choice === "closeAbove") s.closeTabs(above);
  else if (choice === "closeBelow") s.closeTabs(below);
}

export async function openArcMultiMenu(windowId: string, ids: string[]) {
  const s = store();
  const n = ids.length;
  const tabs = ids.map((id) => s.tabs[id]!);
  const allPinned = ids.every((id) => inPinnedContainer(s, id));
  const choice = await chooseFromMenu<SpaceChoice, string>([
    ...copyItems(s, true),
    sep,
    { id: "duplicate", title: "Duplicate" },
    {
      id: "moveTo",
      title: "Move to",
      enabled: !tabs.some((t) => isIncognitoProfile(t.profileId)),
      children: [...spaceItems(s, tabs[0]!.profileId), sep, { id: "newGroup", title: `New Folder with ${n} Items`, enabled: !tabs.every((t) => pinSection(t) === "tile") }],
    },
    sep,
    ...(allPinned ? [{ id: "unpin", title: "Remove Pins" }] : [{ id: "close", title: "Close Tabs", ...menuShortcut("closeTab", s) }, { id: "archive", title: "Archive Tabs" }]),
  ]);
  const here = ids.filter((id) => store().tabs[id]?.windowId === windowId);
  if (!choice || !here.length) return;
  if (typeof choice !== "string") void moveTabsToProfile(here, choice.profileId);
  else if (choice === "copy") copyUrls(here, false);
  else if (choice === "copyMd") copyUrls(here, true);
  else if (choice === "duplicate") here.forEach((id) => store().duplicateTab(id));
  else if (choice === "newGroup") newGroupWithSelection(windowId, here);
  else if (choice === "unpin") store().pinTabs(here, false);
  else if (choice === "close" || choice === "archive") store().closeTabs(here);
  if (choice !== "copy" && choice !== "copyMd") store().setSelection(windowId, []);
}

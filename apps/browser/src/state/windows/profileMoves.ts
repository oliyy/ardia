import type { BrowserState } from "../browser/store";
import type { Tab } from "../browser/types";
import { FAVORITES, dropNodes, placeNodes, tabNode } from "../pins/pinTree";
import { IDLE_LIVE, isIncognitoProfile, isPinnedRow, navigationTo, newId, pinKeyOf } from "../browser/model";
import { markPinned } from "../pins/pinChoices";
import { adoptionRequired, hasLoadedPage, hasPage, IDLE, loadedPage, withWake } from "../tabs/pageSession";
import { removeTabs } from "../tabs/tabs";
import { orderSections } from "../groups/groups";
import { withFolderMovedToProfile } from "../pins/folderMoves";
import { groupTree, regrouped, splitsWithin, withSplitsBack } from "./groupMoves";

export function intoProfile(s: BrowserState, tabId: string, profileId: string): BrowserState {
  const tab = s.tabs[tabId];
  const w = tab && s.windows[tab.windowId];
  if (!tab || !w || w.kind === "private" || !s.profiles[profileId] || tab.profileId === profileId || adoptionRequired(tab)) return s;
  const next = removeTabs(s, [tabId], false);
  const base = next.windows[w.id] ?? { ...w, tabIds: [], activeTabIds: {} };
  const loaded = hasLoadedPage(tab);
  const moved: Tab = { ...tab, profileId, page: loaded ? loadedPage(navigationTo(tab.url)) : hasPage(tab) ? IDLE : withWake(tab.page, undefined), lastActiveAt: Date.now() };
  const pinChoices = tab.pin ? markPinned(next.pinChoices, profileId, { tabs: [pinKeyOf(moved)], placed: [pinKeyOf(moved)] }) : next.pinChoices;
  const movedNode = tabNode(pinKeyOf(moved));
  const held = Object.values(next.tabs).some((t) => t.id !== tabId && t.profileId === tab.profileId && !t.liveItem && pinKeyOf(t) === pinKeyOf(tab));
  let pinPlace = held ? next.pinPlace : dropNodes(next.pinPlace, tab.profileId, [movedNode]);
  if (tab.pin) pinPlace = placeNodes(pinPlace, profileId, [movedNode], isPinnedRow(tab) ? null : FAVORITES, null);
  const tabs = { ...next.tabs, [tabId]: moved };
  const index = Math.min(w.tabIds.indexOf(tabId), base.tabIds.length);
  const tabIds = [...base.tabIds];
  tabIds.splice(index, 0, tabId);
  return {
    ...next,
    tabs,
    pinChoices,
    pinPlace,
    live: { ...next.live, [tabId]: IDLE_LIVE },
    windows: { ...next.windows, [w.id]: { ...base, tabIds: orderSections(tabIds, tabs, next.groups) } },
    windowOrder: next.windowOrder.includes(w.id) ? next.windowOrder : s.windowOrder,
  };
}

export function groupIntoProfile(s: BrowserState, groupId: string, profileId: string): [BrowserState, Map<string, string>] {
  const g = s.groups[groupId];
  if (!g || g.profileId === profileId || !s.profiles[profileId] || isIncognitoProfile(g.profileId)) return [s, new Map()];
  const tree = groupTree(s.groups, groupId);
  const kept = splitsWithin(s, g.tabIds);
  const moved = g.tabIds.reduce((acc, id) => intoProfile(acc, id, profileId), s);
  const ids = new Map(tree.map((x) => [x.id, newId("g")]));
  return [withFolderMovedToProfile(s, withSplitsBack(regrouped(moved, tree, g.windowId, profileId, true, ids), kept, g.windowId), g, profileId, ids), ids];
}

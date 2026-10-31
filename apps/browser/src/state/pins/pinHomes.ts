import type { BrowserState } from "../browser/store";
import { changedIds } from "../browser/changes";
import { pinnedGroupMembers } from "../browser/structure";
import { pinKeyOf } from "../browser/model";
import type { Tab } from "../browser/types";
import { isGroupNode, tableOf, tabNode } from "./pinTree";

type HomeSource = Pick<BrowserState, "tabs" | "groups" | "windows" | "pinPlace">;

const inPinnedFolder = (s: Pick<BrowserState, "pinPlace">, t: Tab) => !t.liveItem && isGroupNode(tableOf(s.pinPlace, t.profileId)[tabNode(pinKeyOf(t))]?.parent ?? "");

export const pinHome = (t: Pick<Tab, "url" | "pinnedUrl">, housed: boolean): string | null => (housed ? t.pinnedUrl || t.url || null : null);

export function settlePinHomes(s: HomeSource, prev: HomeSource): Pick<BrowserState, "tabs"> | null {
  if (s.tabs === prev.tabs && s.groups === prev.groups && s.pinPlace === prev.pinPlace) return null;
  const members = pinnedGroupMembers(s.groups);
  const ids = s.groups !== prev.groups || s.windows !== prev.windows || s.pinPlace !== prev.pinPlace ? Object.keys(s.tabs) : changedIds(s.tabs, prev.tabs);
  let tabs: Record<string, Tab> | null = null;
  for (const id of ids) {
    const t = s.tabs[id];
    if (!t) continue;
    const home = pinHome(t, !!t.pin || members.has(id) || inPinnedFolder(s, t));
    if (home === t.pinnedUrl) continue;
    tabs ??= { ...s.tabs };
    tabs[id] = { ...t, pinnedUrl: home };
  }
  return tabs ? { tabs } : null;
}

export function pinnedTabsLeaveLive(s: Pick<BrowserState, "tabs">, prev: Pick<BrowserState, "tabs">): Pick<BrowserState, "tabs"> | null {
  if (s.tabs === prev.tabs) return null;
  let tabs: Record<string, Tab> | null = null;
  for (const id of changedIds(s.tabs, prev.tabs)) {
    const t = s.tabs[id];
    if (!t?.pin || !t.liveItem || prev.tabs[id]?.pin) continue;
    tabs ??= { ...s.tabs };
    const { liveItem: _, ...rest } = t;
    tabs[id] = rest;
  }
  return tabs ? { tabs } : null;
}

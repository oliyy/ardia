import { showMenu } from "../../platform/menus";
import { focus, openWindow } from "../browser/actions";
import { menuShortcut } from "../commands/commandShortcuts";
import { closeWindowAnimated, isWindowClosing } from "../windows/closeAnimated";
import { destinationStillMaps, resolveExternalLinks } from "./linkRoutes";
import { runsJavaScript } from "../settings/scriptUrls";
import { profileAccentOf } from "../profiles/looks";
import { useBrowser } from "../browser/store";
import { activeTabId } from "../browser/model";
import { isSmall, mainWindowFor } from "../windows/small";
import { navigationOf } from "../tabs/pageSession";
import { asAdoptId } from "../tabs/adoptIds";
import type { AdoptId } from "../browser/types";

const store = () => useBrowser.getState();

export function openLittleArdia(url?: string, profileId?: string, adoptId?: AdoptId, requiresAdoption?: boolean, background?: boolean, linkPointer?: [number, number]): string {
  const id = store().createWindow({ kind: "small", url, profileId, adoptId, requiresAdoption, background, linkPointer });
  if (!url) store().openPanel(id, "");
  return id;
}


export function openExternalUrls(given: string[], pointer?: [number, number]) {
  const settings = store().settings;
  const urls = settings.allowJavaScriptFromAppleEvents ? given : given.filter((url) => !runsJavaScript(url, settings));
  if (!urls.length) return;
  void resolveExternalLinks(urls).then((links) => {
    if (!links || links.length !== urls.length) return console.warn("Couldn't route links from other apps");
    let main: string | undefined;
    urls.forEach((url, i) => {
      const link = links[i];
      if (!link) return console.warn("Couldn't route a link from another app");
      if ("dismissed" in link) return;
      if (!destinationStillMaps(link.profileId, link.engine)) return console.warn("A link's profile changed before it opened");
      if (link.action === "little") return void openLittleArdia(url, link.profileId, asAdoptId(link.adoptId), link.requiresAdoption, false, pointer);
      main = openLinkInMainWindow(url, link.profileId, asAdoptId(link.adoptId), link.requiresAdoption);
    });
    if (main) focus(main);
  });
}

function openLinkInMainWindow(url: string, profileId: string, adoptId: AdoptId | undefined, requiresAdoption: boolean | undefined): string {
  const s = store();
  const w = s.windows[mainWindowFor(s, profileId) ?? ""];
  if (!w) return openWindow({ url, profileId, adoptId, requiresAdoption });
  const blank = w.tabIds.length === 1 ? s.tabs[w.tabIds[0]!] : undefined;
  const intoBlank = blank && !blank.url && !navigationOf(blank) && blank.profileId === profileId && !s.windowUi[w.id]?.panel.open;
  if (intoBlank && !adoptId && !requiresAdoption) s.navigate(blank.id, url);
  else {
    s.newTab(w.id, { url, profileId, adoptId, requiresAdoption });
    if (intoBlank) store().closeTab(blank.id);
  }
  return w.id;
}

export function openInMainWindow(windowId: string) {
  const s = store();
  if (!isSmall(s, windowId)) return;
  const tabId = activeTabId(s, windowId);
  const tab = tabId ? s.tabs[tabId] : undefined;
  const target = mainWindowFor(s, tab?.profileId ?? s.windows[windowId]!.profileId);
  if (!tab?.url) {
    s.closeWindow(windowId);
    if (target) focus(target);
    else openWindow({ profileId: tab?.profileId });
    return;
  }
  const moved = s.moveTabsToWindow([tab.id], target ?? null);
  if (moved) focus(moved);
}

export function moveLittleArdiaToProfile(windowId: string, profileId: string) {
  const s = store();
  const w = s.windows[windowId];
  if (!w || !isSmall(s, windowId) || isWindowClosing(windowId) || !s.profiles[profileId] || w.profileId === profileId) return;
  const tabId = activeTabId(s, windowId);
  const url = (tabId ? s.tabs[tabId]?.url : undefined) || undefined;
  const id = store().createWindow({ kind: "small", url, profileId, frame: w.frame });
  if (!url) store().openPanel(id, "");
  closeWindowAnimated(windowId, id, () => {
    if (tabId) useBrowser.setState((now) => ({ closedTabs: now.closedTabs.filter((c) => c.tabId !== tabId) }));
  });
}

export function cycleLittleArdiaProfile(windowId: string, delta: 1 | -1) {
  const s = store();
  const w = s.windows[windowId];
  if (!w || s.profileOrder.length < 2) return;
  const i = s.profileOrder.indexOf(w.profileId);
  moveLittleArdiaToProfile(windowId, s.profileOrder[(i + delta + s.profileOrder.length) % s.profileOrder.length]!);
}

export async function openLittleArdiaProfileMenu(windowId: string) {
  const s = store();
  const current = s.windows[windowId]?.profileId;
  const choice = await showMenu(
    s.profileOrder.map((id) => ({
      id,
      title: s.profiles[id]!.name,
      checked: id === current,
      swatch: profileAccentOf(s.profiles[id]),
      ...menuShortcut(`switchProfile:${id}`, s),
    })),
  );
  if (choice) moveLittleArdiaToProfile(windowId, choice);
}

export function closeLittleArdia(windowId: string) {
  if (isSmall(store(), windowId)) closeWindowAnimated(windowId, null);
}

export function closeLittleArdiaOnEscape(tabId: string) {
  const s = store();
  const tab = s.tabs[tabId];
  if (!tab || !isSmall(s, tab.windowId) || s.find[tabId]?.open || s.windowUi[tab.windowId]?.panel.open) return;
  closeLittleArdia(tab.windowId);
}

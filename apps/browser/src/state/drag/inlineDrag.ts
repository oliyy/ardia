import { useBrowser } from "../browser/store";
import { tabTitle } from "../browser/model";
import { addressBarInSidebar } from "../windows/layout";

export type GhostFace = { title: string; url: string; favicon: string | null; icon: string | null; profileId: string };

export type InlineDrag = { windowId: string; profileId: string; key: string; tabId: string; tabProfileId: string; face: GhostFace };

export function inlineDragNow(windowId: string, key: string, tabId: string): InlineDrag | null {
  const s = useBrowser.getState();
  const tab = s.tabs[tabId];
  const w = s.windows[windowId];
  if (!tab || !w || tab.windowId !== windowId || !addressBarInSidebar(s, windowId)) return null;
  const face = { title: tabTitle(tab), url: tab.url, favicon: tab.favicon, icon: tab.customIcon, profileId: tab.profileId };
  return { windowId, profileId: w.profileId, key, tabId, tabProfileId: tab.profileId, face };
}

export function inlineHoldsNow(inline: InlineDrag, windowId: string): boolean {
  const s = useBrowser.getState();
  const w = s.windows[inline.windowId];
  const tab = s.tabs[inline.tabId];
  return inline.windowId === windowId && !!w && w.profileId === inline.profileId && addressBarInSidebar(s, inline.windowId) && tab?.windowId === inline.windowId && tab.profileId === inline.tabProfileId;
}

export const watchBrowser = (listener: () => void) => useBrowser.subscribe(listener);

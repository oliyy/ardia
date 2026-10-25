import { useBrowser, type BrowserState } from "../../store/browser";
import { useTab } from "../../store/hooks";
import { activeTabId } from "../../store/model";
import { splitIndex } from "../../store/structure";
import type { Tab } from "../../store/types";

export const ACTIVE = 1;
export const SELECTED = 2;
export const PLAYING = 4;
export const LOADING = 8;
export const VISIBLE = 16;

function rowFlags(s: BrowserState, windowId: string, tabId: string): number {
  const tab = s.tabs[tabId];
  const live = s.live[tabId];
  let flags = 0;
  const active = tab ? activeTabId(s, tab.windowId, tab.profileId) : undefined;
  if (active === tabId) flags |= ACTIVE;
  else if (active && splitIndex(s.splits).get(active)?.[0]?.tabIds.includes(tabId)) flags |= VISIBLE;
  if (s.selection[windowId]?.includes(tabId)) flags |= SELECTED;
  if (live?.playingAudio) flags |= PLAYING;
  if (live?.isLoading) flags |= LOADING;
  return flags;
}

export function useRowState(tabId: string, windowId: string): { tab: Tab | undefined; flags: number } {
  const tab = useTab(tabId);
  const flags = useBrowser((s) => rowFlags(s, windowId, tabId));
  return { tab, flags };
}

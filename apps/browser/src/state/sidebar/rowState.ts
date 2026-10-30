import { useRef } from "react";
import { useBrowser, type BrowserState } from "../browser/store";
import { activeTabId } from "../browser/model";
import { splitIndex } from "../browser/structure";
import type { Tab } from "../browser/types";
import { engineMark, type PageEngine } from "../engines/engines";
import { isPageUnloaded } from "../pins/pinShare";
import { splitTabIds } from "../splits/splits";
import { useBrowserWhile } from "../tabs/tabWatch";
import { muteState, type MuteState } from "../tabs/mute";

export const ACTIVE = 1;
export const SELECTED = 2;
export const PLAYING = 4;
export const LOADING = 8;
export const FADED = 16;
const ENGINE_MARKS: Record<PageEngine, number> = { chromium: 32, webkit: 64 };
export const ICON_MARKS = FADED | ENGINE_MARKS.chromium | ENGINE_MARKS.webkit;
export const VISIBLE = 128;
const MUTED_TAB = 256;
const MUTED_SITE = 512;

export const mutedFrom = (flags: number): MuteState => (flags & MUTED_SITE ? "site" : flags & MUTED_TAB ? "tab" : null);

export function iconMarks(s: BrowserState, tabId: string): number {
  const faded = s.settings.fadeUnloadedTabs && isPageUnloaded(s, tabId) ? FADED : 0;
  const mark = engineMark(s, tabId);
  return mark ? faded | ENGINE_MARKS[mark] : faded;
}

export const markedEngine = (marks: number): PageEngine | null =>
  marks & ENGINE_MARKS.webkit ? "webkit" : marks & ENGINE_MARKS.chromium ? "chromium" : null;

export const useIconMarks = (tabId: string | undefined, given: number | undefined): number =>
  useBrowserWhile(given === undefined && !!tabId, (s) => given ?? (tabId ? iconMarks(s, tabId) : 0));

function rowFlags(s: BrowserState, windowId: string, tabId: string): number {
  const tab = s.tabs[tabId];
  const live = s.live[tabId];
  let flags = iconMarks(s, tabId);
  const active = tab ? activeTabId(s, tab.windowId, tab.profileId) : undefined;
  if (active === tabId) flags |= ACTIVE;
  else if (active) {
    const split = splitIndex(s.splits).get(active)?.[0];
    if (split && splitTabIds(split).includes(tabId)) flags |= VISIBLE;
  }
  if (s.selection[windowId]?.includes(tabId)) flags |= SELECTED;
  if (live?.playingAudio) flags |= PLAYING;
  if (live?.isLoading) flags |= LOADING;
  if (tab) {
    const mute = muteState(s, tab);
    if (mute) flags |= mute === "site" ? MUTED_SITE : MUTED_TAB;
  }
  return flags;
}

type RowState = { tab: Tab | undefined; flags: number };

export function useRowState(tabId: string, windowId: string): RowState {
  const last = useRef<RowState | null>(null);
  return useBrowser((s) => {
    const tab = s.tabs[tabId];
    const flags = rowFlags(s, windowId, tabId);
    const prev = last.current;
    return prev && prev.tab === tab && prev.flags === flags ? prev : (last.current = { tab, flags });
  });
}

import { create } from "zustand";
import { goBackAcrossEngines } from "../engines/actions";
import { livePageId, withLivePage } from "./livePage";
import { webviews } from "../../platform/webviews";
import { useBrowser } from "../browser/store";
import { useTabLive } from "../browser/hooks";
import type { TabLive } from "../browser/types";
import { pageOf, usePage } from "./pageState";
import { historyOf } from "../history/history";

const store = () => useBrowser.getState();

export function canGoBack(tabId: string, live: Pick<TabLive, "canGoBack">): boolean {
  return live.canGoBack || !!pageOf(tabId).engineBack;
}

export function canGoForward(live: Pick<TabLive, "canGoForward">): boolean {
  return live.canGoForward;
}

export function useHistoryAvailability(tabId: string) {
  const back = useTabLive(tabId, (l) => l.canGoBack);
  const forward = useTabLive(tabId, (l) => l.canGoForward);
  const engineBack = usePage(tabId, (p) => !!p.engineBack);
  return { back: back || engineBack, forward };
}

export function goBack(tabId: string): void {
  if (livePageId(tabId) !== tabId) return void withLivePage(tabId, (_, id) => goBack(id));
  const live = store().live[tabId];
  if (live?.canGoBack) return void webviews.get(tabId)?.goBack();
  if (pageOf(tabId).engineBack) void goBackAcrossEngines(tabId);
}

export function goForward(tabId: string): void {
  if (livePageId(tabId) !== tabId) return void withLivePage(tabId, (_, id) => goForward(id));
  void webviews.get(tabId)?.goForward();
}

export type HistoryItem = {
  key: string;
  title: string;
  url: string;
  offset: number;
};

export async function historyItems(asked: string, direction: -1 | 1, max = 15): Promise<HistoryItem[]> {
  const tabId = livePageId(asked);
  const list = (await webviews.get(tabId)?.navigationEntries()) ?? [];
  const current = list.findIndex((e) => e.current);
  const items: HistoryItem[] = [];
  if (current >= 0) {
    for (let i = current + direction; i >= 0 && i < list.length && items.length < max; i += direction) {
      const e = list[i]!;
      items.push({ key: String(i), title: e.title || e.url, url: e.url, offset: i - current });
    }
  }
  return items;
}

export function goToHistoryItem(tabId: string, item: HistoryItem): void {
  if (livePageId(tabId) !== tabId) return void withLivePage(tabId, (_, id) => goToHistoryItem(id, item));
  if (item.offset === -1) return goBack(tabId);
  if (item.offset === 1) return goForward(tabId);
  if (item.offset) void webviews.get(tabId)?.goToOffset(item.offset);
}

type HistoryMenu = { tabId: string; direction: -1 | 1; items: HistoryItem[] };
export const useHistoryMenu = create<{ menu: HistoryMenu | null }>()(() => ({ menu: null }));

export async function openHistoryMenu(tabId: string, direction: -1 | 1) {
  const items = await historyItems(tabId, direction);
  if (!items.length) return;
  useHistoryMenu.setState({ menu: { tabId, direction, items } });
}

export const closeHistoryMenu = () => useHistoryMenu.setState({ menu: null });

export const closeHistoryMenuOf = (tabId: string) => {
  if (useHistoryMenu.getState().menu?.tabId === tabId) closeHistoryMenu();
};

export function historyFavicons(profileId: string, items: readonly { url: string }[]): Map<string, string | null> {
  const urls = new Set(items.map((i) => i.url));
  return new Map(historyOf(useBrowser.getState(), profileId).filter((h) => urls.has(h.url)).map((h) => [h.url, h.favicon]));
}

export function toggleHistoryMenu(tabId: string, direction: -1 | 1) {
  const open = useHistoryMenu.getState().menu;
  if (open?.tabId === tabId && open.direction === direction) return closeHistoryMenu();
  void openHistoryMenu(tabId, direction);
}

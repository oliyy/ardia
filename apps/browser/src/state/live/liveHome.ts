import { samePage } from "../../lib/url";
import { useBrowser } from "../browser/store";
import type { Tab } from "../browser/types";
import { live } from "./store";
import type { LiveItem } from "./types";

export const awayFromLiveItem = (url: string | undefined, item: Pick<LiveItem, "url">) => !!url && !samePage(url, item.url);

function homeItemOf(t: Pick<Tab, "liveItem">): LiveItem | null {
  const ref = t.liveItem;
  return ref ? (live().items[ref.folderId]?.find((it) => it.id === ref.itemId) ?? null) : null;
}

export function awayFromLiveHome(t: Pick<Tab, "url" | "liveItem">): boolean {
  const item = homeItemOf(t);
  return !!item && awayFromLiveItem(t.url, item);
}

export function returnToLiveItem(tabId: string) {
  const s = useBrowser.getState();
  const t = s.tabs[tabId];
  const item = t && homeItemOf(t);
  if (t && item && awayFromLiveItem(t.url, item)) s.navigate(tabId, item.url);
}

export function separateFromLiveItem(tabId: string) {
  const s = useBrowser.getState();
  const t = s.tabs[tabId];
  if (t && awayFromLiveHome(t)) s.updateTab(tabId, { liveItem: undefined });
}

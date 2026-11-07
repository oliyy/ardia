import { useBrowser } from "../browser/store";
import { activeTabId } from "../browser/model";
import { webviews } from "../../platform/webviews";

export type BarDismissal = "escape" | "closeKey";

export function closePanelToPage(windowId: string, tabId: string, reason?: BarDismissal) {
  useBrowser.getState().closePanel(windowId);
  const now = useBrowser.getState();
  if (activeTabId(now, windowId) !== tabId) return;
  if (reason && now.tabs[tabId]?.url && now.tabs[tabId]?.windowId === windowId) void webviews.get(tabId)?.focus();
}

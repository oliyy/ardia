import { useBrowser, type BrowserState } from "../browser/store";

export const SIDEBAR_MIN_WIDTH = 160;
export const SIDEBAR_MAX_WIDTH = 700;
const PAGE_ROOM = 220;

export const widestSidebar = (windowWidth: number | undefined) => Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, (windowWidth ?? Infinity) - PAGE_ROOM));

export const fittedSidebarWidth = (s: BrowserState, windowId: string) => Math.min(s.settings.sidebarWidth, widestSidebar(s.windows[windowId]?.frame?.[2]));

export const fittedSidebarWidthNow = (windowId: string) => fittedSidebarWidth(useBrowser.getState(), windowId);

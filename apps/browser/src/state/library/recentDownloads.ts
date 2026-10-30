import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { markHoverProps } from "../../lib/hoverMarks";
import { sharePageVia } from "../../platform/share";
import { copyFile, fileExists, fileOpenerName, openFile, revealFile, showMenu, type MenuItem } from "../app/system";
import { useBrowser, type BrowserState } from "../browser/store";
import { cancelDownload } from "../downloads/actions";
import { trashDownload } from "../downloads/downloadMenu";
import { downloadsIn, type StoredDownload } from "../downloads/downloadsSlice";
import { removeDownload } from "../windows/actions";
import { fileKind } from "./groups";
import { libraryVisible, watchLibrary } from "./store";
import { RECENT_PEEK, RECENT_SCRIM } from "./tokens";

export type RecentPeek = { shown: boolean; at: number; count: number; token: number };
type Hover = { button: boolean; dock: boolean; panel: boolean; menu: boolean; timer?: ReturnType<typeof setTimeout> };
type Region = "button" | "dock" | "panel";

const usePeekStore = create<Record<string, RecentPeek | undefined>>()(() => ({}));
const hovers = new Map<string, Hover>();
const hoverProps = new Map<string, { button: object; dock: object }>();
let peekTokens = 0;

function hoverOf(windowId: string) {
  let h = hovers.get(windowId);
  if (!h) hovers.set(windowId, (h = { button: false, dock: false, panel: false, menu: false }));
  return h;
}

export function recentDownloads(s: Pick<BrowserState, "downloads" | "windows" | "profiles">, windowId: string) {
  return downloadsIn(s, windowId)
    .filter((d) => d.state === "finished" || d.state === "downloading")
    .slice(0, RECENT_PEEK.maxRows);
}

const setPeek = (windowId: string, peek: RecentPeek | undefined) => usePeekStore.setState({ [windowId]: peek });

export const updateRecentPeekCount = (windowId: string, peek: RecentPeek, count: number) => setPeek(windowId, { ...peek, count });

function show(windowId: string) {
  const count = recentDownloads(useBrowser.getState(), windowId).length;
  if (!count || libraryVisible(windowId)) return;
  setPeek(windowId, { shown: true, at: Date.now(), count, token: ++peekTokens });
}

export function hideRecentPeek(windowId: string) {
  const peek = usePeekStore.getState()[windowId];
  if (!peek?.shown) return;
  const token = ++peekTokens;
  setPeek(windowId, { ...peek, shown: false, at: Date.now(), token });
  setTimeout(() => usePeekStore.getState()[windowId]?.token === token && setPeek(windowId, undefined), RECENT_SCRIM.end);
}

export function settleRecentPeek(windowId: string) {
  const h = hoverOf(windowId);
  clearTimeout(h.timer);
  h.timer = setTimeout(() => decide(windowId), RECENT_PEEK.hoverSettle);
}

function decide(windowId: string) {
  const h = hoverOf(windowId);
  const shown = !!usePeekStore.getState()[windowId]?.shown;
  if (h.panel || h.menu || (h.button && shown)) return;
  if (h.button) h.timer = setTimeout(() => show(windowId), RECENT_PEEK.dwell - RECENT_PEEK.hoverSettle);
  else if (shown && h.dock) h.timer = setTimeout(() => hideRecentPeek(windowId), RECENT_PEEK.dockRest - RECENT_PEEK.hoverSettle);
  else if (shown) hideRecentPeek(windowId);
}

function dismiss(windowId: string) {
  clearTimeout(hoverOf(windowId).timer);
  if (usePeekStore.getState()[windowId]) setPeek(windowId, undefined);
}

export function recentPeekRegion(windowId: string, region: Region) {
  return markHoverProps({
    onMouseEnter: () => {
      hoverOf(windowId)[region] = true;
      settleRecentPeek(windowId);
    },
    onMouseLeave: () => {
      hoverOf(windowId)[region] = false;
      settleRecentPeek(windowId);
    },
  });
}

function windowHoverProps(windowId: string) {
  let props = hoverProps.get(windowId);
  if (!props) hoverProps.set(windowId, (props = { button: recentPeekRegion(windowId, "button"), dock: recentPeekRegion(windowId, "dock") }));
  return props;
}

export const recentDownloadsButtonHover = (windowId: string) => windowHoverProps(windowId).button;
export const recentDownloadsDockHover = (windowId: string) => windowHoverProps(windowId).dock;

export const dismissRecentPeekWithLibrary = (windowId: string) => watchLibrary(() => libraryVisible(windowId) && dismiss(windowId));

export function forgetRecentPeek(windowId: string) {
  dismiss(windowId);
  hovers.delete(windowId);
  hoverProps.delete(windowId);
}

export function leaveRecentPanel(windowId: string) {
  const h = hoverOf(windowId);
  h.panel = false;
  h.menu = false;
}

export const useRecentPeek = (windowId: string) => usePeekStore((all) => all[windowId]);

export const useRecentDownloadIds = (windowId: string) => useBrowser(useShallow((s) => recentDownloads(s, windowId).map((d) => d.id)));

export const useStoredDownload = (id: string): StoredDownload | undefined => useBrowser((s) => s.downloads.find((d) => d.id === id));

const fileUrl = (path: string) => `file://${path.split("/").map(encodeURIComponent).join("/")}`;

function copyTitle(d: StoredDownload) {
  if (/\.pdf$/i.test(d.filename) || d.mimeType === "application/pdf") return "Copy PDF";
  const kind = fileKind(d.filename, d.mimeType);
  return kind === "image" ? "Copy Image" : kind === "movie" ? "Copy Video" : "Copy File";
}

async function menuFor(d: StoredDownload, windowId: string) {
  if (d.state === "downloading") {
    if ((await showMenu([{ id: "cancel", title: "Cancel Download" }])) === "cancel") void cancelDownload(d.id);
    return;
  }
  if (d.state !== "finished") return;
  const exists = fileExists(d.path);
  const opener = exists ? await fileOpenerName(d.path) : null;
  const items: MenuItem[] = [
    { id: "copy", title: copyTitle(d), enabled: exists },
    { separator: true },
    { id: "messages", title: "Send via iMessage", enabled: exists },
    { id: "airdrop", title: "AirDrop", enabled: exists },
    { separator: true },
    { id: "open", title: opener ? `Open in ${opener}` : "Open", enabled: exists },
    { id: "reveal", title: "Show in Finder", enabled: exists },
    { separator: true },
    { id: "hide", title: "Hide from Ardia" },
    { id: "trash", title: "Move to Trash", enabled: exists },
  ];
  const choice = await showMenu(items);
  if (choice === "copy") void copyFile(d.path);
  if (choice === "messages") void sharePageVia("Messages", fileUrl(d.path), d.filename, windowId);
  if (choice === "airdrop") void sharePageVia("AirDrop", fileUrl(d.path), d.filename, windowId);
  if (choice === "open") void openFile(d.path);
  if (choice === "reveal") void revealFile(d.path);
  if (choice === "hide") removeDownload(d.id);
  if (choice === "trash") void trashDownload(d);
}

export async function openRecentDownloadMenu(d: StoredDownload, windowId: string) {
  const h = hoverOf(windowId);
  h.menu = true;
  try {
    await menuFor(d, windowId);
  } finally {
    h.menu = false;
    settleRecentPeek(windowId);
  }
}

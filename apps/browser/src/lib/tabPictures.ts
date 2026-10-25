import { useBrowser } from "../store/browser";
import { isIncognitoProfile } from "../store/model";
import { splitOf } from "../store/splits";
import type { Tab } from "../store/types";
import { webviewMount, webviews } from "./webviews";

type Picture = { data: string; frame: [number, number, number, number] };

const SETTLE_MS = 1500;
const KEEP = 40;
const pictures = new Map<string, { url: string; profileId: string; picture: Picture }>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let started = false;

export function lastPicture(tabId: string): Picture | null {
  const kept = pictures.get(tabId);
  const tab = useBrowser.getState().tabs[tabId];
  return kept && tab && kept.url === tab.url && kept.profileId === tab.profileId && !isPrivate(tab) ? kept.picture : null;
}

function isPrivate(tab: Tab): boolean {
  return isIncognitoProfile(tab.profileId) || !!useBrowser.getState().windows[tab.windowId]?.incognito;
}

function shownOnScreen(tabId: string): boolean {
  const s = useBrowser.getState();
  const tab = s.tabs[tabId];
  const w = tab && s.windows[tab.windowId];
  if (!tab?.url || !w || isPrivate(tab)) return false;
  const active = w.activeTabIds[w.profileId];
  return tabId === active || !!splitOf(s, active)?.tabIds.includes(tabId);
}

export function refreshPicture(tabId: string): Promise<boolean> {
  const view = webviews.get(tabId);
  const mount = webviewMount(tabId);
  const url = useBrowser.getState().tabs[tabId]?.url;
  const profileId = useBrowser.getState().tabs[tabId]?.profileId;
  if (!view || !mount || !url || !profileId || !shownOnScreen(tabId)) return Promise.resolve(false);
  return view
    .capturePicture(0.25)
    .then((picture) => {
      const tab = useBrowser.getState().tabs[tabId];
      if (!picture || webviews.get(tabId) !== view || webviewMount(tabId) !== mount || tab?.url !== url || tab.profileId !== profileId || isPrivate(tab)) return false;
      pictures.delete(tabId);
      pictures.set(tabId, { url, profileId, picture });
      for (const old of pictures.keys()) {
        if (pictures.size <= KEEP) break;
        pictures.delete(old);
      }
      return true;
    })
    .catch(() => false);
}

export function startTabPictures() {
  if (started) return;
  started = true;
  useBrowser.subscribe((s, prev) => {
    if (s.windows === prev.windows && s.tabs === prev.tabs) return;
    for (const [windowId, timer] of timers)
      if (!s.windows[windowId]) {
        clearTimeout(timer);
        timers.delete(windowId);
      }
    for (const w of Object.values(s.windows)) {
      const id = w.activeTabIds[w.profileId];
      if (!id || w.incognito) continue;
      const was = prev.windows[w.id];
      if (id === was?.activeTabIds[was.profileId] && s.tabs[id]?.url === prev.tabs[id]?.url) continue;
      if (isIncognitoProfile(s.tabs[id]?.profileId ?? "")) continue;
      clearTimeout(timers.get(w.id));
      timers.set(
        w.id,
        setTimeout(() => {
          timers.delete(w.id);
          const now = useBrowser.getState().windows[w.id];
          if (now?.activeTabIds[now.profileId] === id) void refreshPicture(id);
        }, SETTLE_MS),
      );
    }
    if (s.tabs !== prev.tabs) for (const [id, kept] of pictures) if (s.tabs[id]?.url !== kept.url || s.tabs[id]?.profileId !== kept.profileId) pictures.delete(id);
  });
}

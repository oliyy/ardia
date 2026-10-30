import { onAppEvent } from "../../platform/app";
import { onWindowEvent } from "../../platform/windows";
import { useBrowser, type BrowserState } from "../browser/store";

export const watchWindowProfile = (windowId: () => string, changed: () => void) =>
  useBrowser.subscribe((s, prev) => {
    const id = windowId();
    if (s.windows[id]?.profileId !== prev.windows[id]?.profileId) changed();
  });

export const watchWindows = (changed: (windows: BrowserState["windows"]) => void) =>
  useBrowser.subscribe((s, prev) => {
    if (s.windows !== prev.windows) changed(s.windows);
  });

export function watchWindowActive(windowId: string, changed: (active: boolean) => void): () => void {
  const subscriptions = [
    onWindowEvent((e) => {
      if (e.type === "focus") changed(e.id === windowId);
    }),
    onAppEvent((e) => {
      if (e.type === "resignActive" || e.type === "screenLocked") changed(false);
    }),
  ];
  return () => subscriptions.forEach((subscription) => subscription.remove());
}

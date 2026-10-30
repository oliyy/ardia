import { useContext, useMemo } from "react";
import { spaceLookSource, type LookSource } from "../../lib/profileLook";
import { PageProfileContext, WindowContext } from "../browser/hooks";
import { useBrowser, type BrowserState } from "../browser/store";
import type { Profile } from "../browser/types";
import { focusedWindowOf } from "../windows/ui";

type ResolveLook<T> = (incognito: boolean, profile: Profile | undefined, appDark: boolean, source: LookSource) => T;

export type LookSubscription<T> = { read: () => T; subscribe: (changed: () => void) => () => void };

function lookOf<T>(s: BrowserState, windowId: string | null, page: string | null, resolve: ResolveLook<T>): T {
  const w = s.windows[windowId ?? focusedWindowOf(s) ?? ""];
  if (w?.kind === "private") return resolve(true, undefined, s.ui.appDark, "own");
  return resolve(false, s.profiles[page ?? w?.profileId ?? s.settings.defaultProfileId], s.ui.appDark, windowId ? spaceLookSource(s.settings) : "utility");
}

function lookSelector<T>(windowId: string | null, page: string | null, resolve: ResolveLook<T>): (s: BrowserState) => T {
  let last: { state: BrowserState; look: T } | null = null;
  return (s) => {
    if (last?.state === s) return last.look;
    const look = lookOf(s, windowId, page, resolve);
    last = { state: s, look };
    return look;
  };
}

export function scopedLookSubscription<T>(windowId: string | null, page: string | null, resolve: ResolveLook<T>): LookSubscription<T> {
  const select = lookSelector(windowId, page, resolve);
  const listeners = new Set<() => void>();
  let shown: T | null = null;
  let stop: (() => void) | null = null;
  const read = () => select(useBrowser.getState());
  return {
    read,
    subscribe(changed) {
      listeners.add(changed);
      if (!stop) {
        shown = read();
        stop = useBrowser.subscribe((s) => {
          const next = select(s);
          if (next === shown) return;
          shown = next;
          for (const notify of [...listeners]) notify();
        });
      }
      return () => {
        listeners.delete(changed);
        if (listeners.size || !stop) return;
        stop();
        stop = null;
      };
    },
  };
}

export function useScopedLookSubscription<T>(resolve: ResolveLook<T>): LookSubscription<T> {
  const windowId = useContext(WindowContext);
  const page = useContext(PageProfileContext);
  return useMemo(() => scopedLookSubscription(windowId, page, resolve), [windowId, page, resolve]);
}

export function useSelectedTabGlowSetting() {
  return useBrowser((s) => s.settings.selectedTabGlow);
}

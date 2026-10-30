import { onAppEvent } from "../../platform/app";
import { onCommand } from "../../platform/commands";
import { discardKeyResponder, restoreKeyResponder, saveKeyResponder } from "../../platform/focus";
import { onWindowEvent } from "../../platform/windows";
import { activeTabId } from "../browser/model";
import { useBrowser } from "../browser/store";
import { requestCreateProfile } from "../profiles/createProfileRequest";
import { switchProfile } from "../browser/actions";
import { toggleNewTabBar } from "../omnibox/newTabBar";
import { openNewTabInSplit } from "../splits/actions";
import { newTab } from "../tabs/actions";
import { useDockMotion } from "../windows/dockMotion";
import { addressBarInSidebar } from "../windows/layout";
import { focusedWindowOf } from "../windows/ui";
import { newPinnedFolder } from "./arcMenus";
import { setSidebarUi, sidebarUi, useSidebarUi, type Anchor } from "./sidebarUi";

export type PlusAction = "space" | "folder" | "split" | "tab";
export type PlusMenuShown = { windowId: string; anchor: Anchor; id: number };
export type PlusOpening = { id: number; windowId: string; start: string; token: number | null; done: boolean; focus: (() => void) | null; stop: () => void };

let openings = 0;
let current: PlusOpening | null = null;

function watched(windowId: string): string | null {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  if (!w) return null;
  const ui = s.windowUi[windowId];
  const u = sidebarUi();
  const dock = useDockMotion.getState();
  return [
    w.profileId,
    activeTabId(s, windowId),
    w.kind === "private",
    addressBarInSidebar(s, windowId),
    focusedWindowOf(s),
    w.frame,
    s.settings.sidebarWidth,
    !!ui?.panel.open,
    !!ui?.downloadsOpen,
    w.sidebarOpen || windowId in dock.peeks,
    !!dock.moving[windowId],
    !!u.iconPicker,
    !!u.searchTabs,
    !!u.switcher,
    !!u.renaming,
    u.dragWidth[windowId] ?? null,
  ].join("|");
}

export const plusMenuLive = (opening: PlusOpening) => !opening.done && current === opening && watched(opening.windowId) === opening.start;

export const plusMenuOpening = (id: number): PlusOpening | null => (current?.id === id ? current : null);

export function dismissPlusOpening(opening: PlusOpening, explicit: boolean) {
  if (opening.done) return;
  const restore = explicit && plusMenuLive(opening) && focusedWindowOf(useBrowser.getState()) === opening.windowId;
  opening.done = true;
  opening.focus = null;
  opening.stop();
  if (current === opening) current = null;
  if (sidebarUi().plusMenu?.id === opening.id) setSidebarUi({ plusMenu: null });
  if (opening.token === null) return;
  if (restore) void restoreKeyResponder(opening.token);
  else discardKeyResponder(opening.token);
}

function watchOpening(opening: PlusOpening): () => void {
  const quit = () => dismissPlusOpening(opening, false);
  const check = () => {
    if (watched(opening.windowId) !== opening.start) quit();
  };
  const subscriptions = [
    onCommand((e) => {
      if ((e.command === "newTab" || e.command === "openSplitPane") && (!e.windowId || e.windowId === opening.windowId)) quit();
    }),
    onAppEvent((e) => {
      if (e.type === "resignActive" || e.type === "screenLocked") quit();
    }),
    onWindowEvent((e) => {
      if ((e.type === "focus" && e.id !== opening.windowId) || (e.type === "close" && e.id === opening.windowId)) quit();
    }),
  ];
  const stops = [useBrowser.subscribe(check), useSidebarUi.subscribe(check), useDockMotion.subscribe(check)];
  return () => {
    subscriptions.forEach((subscription) => subscription.remove());
    stops.forEach((stop) => stop());
  };
}

function beginPlusMenu(windowId: string): PlusOpening | null {
  const start = watched(windowId);
  if (start === null) return null;
  const opening: PlusOpening = { id: ++openings, windowId, start, token: null, done: false, focus: null, stop: () => {} };
  current = opening;
  opening.stop = watchOpening(opening);
  return opening;
}

function showPlusMenu(opening: PlusOpening, anchor: Anchor) {
  if (!plusMenuLive(opening)) return dismissPlusOpening(opening, false);
  void saveKeyResponder(opening.windowId).then((token) => {
    if (opening.done) return discardKeyResponder(token);
    opening.token = token;
    if (!plusMenuLive(opening)) return dismissPlusOpening(opening, false);
    opening.focus?.();
  });
  setSidebarUi({ plusMenu: { windowId: opening.windowId, anchor, id: opening.id } });
}

export function dismissPlusMenu(id: number, explicit: boolean) {
  if (current?.id === id) return dismissPlusOpening(current, explicit);
  if (sidebarUi().plusMenu?.id === id) setSidebarUi({ plusMenu: null });
}

export function dismissPlusMenuIn(windowId: string) {
  if (current?.windowId === windowId) dismissPlusOpening(current, false);
}

export function cancelPlusMenu() {
  if (current) dismissPlusOpening(current, false);
  else if (sidebarUi().plusMenu) setSidebarUi({ plusMenu: null });
}

type Measure = (placed: (anchor: Anchor | null) => void) => void;

export function pressPlusButton(windowId: string, measure: Measure): PlusOpening | null {
  const previous = current;
  if (previous) {
    dismissPlusOpening(previous, previous.windowId === windowId);
    if (previous.windowId === windowId) return null;
  } else if (sidebarUi().plusMenu) setSidebarUi({ plusMenu: null });
  const opening = beginPlusMenu(windowId);
  if (!opening) return null;
  measure((anchor) => {
    if (opening.done) return;
    if (!anchor) return dismissPlusOpening(opening, false);
    showPlusMenu(opening, anchor);
  });
  return opening;
}

export function runPlusAction(menu: PlusMenuShown, action: PlusAction) {
  const opening = current;
  if (!opening || opening.id !== menu.id) return;
  if (!plusMenuLive(opening)) return dismissPlusOpening(opening, false);
  const { windowId } = opening;
  const w = useBrowser.getState().windows[windowId];
  dismissPlusOpening(opening, false);
  if (!w) return;
  if (action === "space") void requestCreateProfile(windowId).then((id) => id && switchProfile(windowId, id));
  else if (action === "folder") {
    if (w.kind !== "private") newPinnedFolder(windowId);
  } else if (action === "split") openNewTabInSplit(windowId);
  else if (!toggleNewTabBar(windowId)) newTab(windowId);
}

import type { OpenWindowRequest } from "../../platform/tabs";
import { focus, openWindow } from "../browser/actions";
import { useBrowser } from "../browser/store";
import { engineProfile } from "../browser/model";
import { peekSourceOf } from "../peek/peek";
import { isSmall, mainWindowFor, originalProfile, privateWindowProfile } from "../windows/small";
import { destinationStillMaps } from "../littleArdia/linkRoutes";
import { openLittleArdia } from "../littleArdia/actions";
import { openLinkInSplit, openSplitPane } from "../splits/actions";
import { asAdoptId, isAdoptKind } from "./adoptIds";

export type { OpenWindowRequest } from "../../platform/tabs";

type PageSource = { windowId: string; profileId: string; tabId?: string };

export function openFromPage(request: OpenWindowRequest, page: PageSource) {
  const { url, requiresAdoption, disposition, profile, point } = request;
  const adoptId = asAdoptId(request.adoptId);
  const s = useBrowser.getState();
  const w = s.windows[page.windowId];
  if (!w) return;
  const peekSource = peekSourceOf(s, page.tabId);
  if (peekSource && disposition === "popup" && s.peekToTab(w.id, { activate: false })) return openFromPage(request, page);
  const from = peekSource ? { ...page, tabId: peekSource } : page;
  if (request.placement) return openPlaced(request, request.placement, from);
  if (disposition === "current" || (disposition === "peek" && (peekSource || isSmall(s, w.id)))) {
    if (page.tabId) s.navigate(page.tabId, url, { userInitiated: false });
    return;
  }
  if (disposition === "peek") {
    if (page.tabId) s.openPeek(page.tabId, url, point ?? null);
    return;
  }
  if (isSmall(s, w.id) && disposition === "popup") return void openLittleArdia(url, from.profileId, adoptId, !!requiresAdoption, false);
  if (isSmall(s, w.id) && disposition !== "window" && disposition !== "incognito") {
    return void s.newTab(w.id, { url, adoptId, openerId: from.tabId, profileId: from.profileId, background: true });
  }
  if (disposition === "split") {
    if (from.tabId) return openLinkInSplit(from.tabId, url, adoptId);
    openSplitPane(w.id, { url, adoptId });
    return;
  }
  if (disposition === "incognito") {
    const profileId = privateWindowProfile(s, w, profile);
    if (isAdoptKind(adoptId, "tab")) return void openWindow({ kind: "private", url, adoptId, profileId });
    return void openWindow({ kind: "private", url, profileId });
  }
  if (disposition === "window") {
    return void openWindow(w.kind === "private" ? { kind: "private", url, profileId: originalProfile(s, w) } : { profileId: from.profileId, url, adoptId });
  }
  const background = disposition === "background" || from.profileId !== w.profileId;
  s.newTab(w.id, { url, adoptId, openerId: from.tabId, profileId: from.profileId, background });
}

export function pageProfileId(windowId: string, pageProfile: string): string {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  if (w && engineProfile(s, w.profileId) === pageProfile) return w.profileId;
  return s.profileOrder.find((p) => engineProfile(s, p) === pageProfile) ?? w?.profileId ?? s.settings.defaultProfileId;
}

function openPlaced(request: OpenWindowRequest, placement: NonNullable<OpenWindowRequest["placement"]>, from: PageSource) {
  const { url, requiresAdoption, disposition } = request;
  const adoptId = asAdoptId(request.adoptId);
  const s = useBrowser.getState();
  const profileId = placement.profileId;
  if (!destinationStillMaps(profileId, placement.engine)) return console.warn("A routed link's profile changed before it opened");
  const required = !!requiresAdoption;
  const background = disposition === "background";
  if (placement.action === "little") return void openLittleArdia(url, profileId, adoptId, required, background);
  if (disposition === "window") return void openWindow({ url, profileId, adoptId, requiresAdoption: required, background });
  const target = isSmall(s, from.windowId) ? mainWindowFor(s, profileId) : from.windowId;
  if (!target || !s.windows[target]) return void openWindow({ url, profileId, adoptId, requiresAdoption: required, background });
  const openerId = profileId === from.profileId ? from.tabId : undefined;
  s.newTab(target, { url, adoptId, requiresAdoption: required, profileId, openerId, background });
  if (!background && target !== from.windowId) focus(target);
}

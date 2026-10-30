import type { StateCreator } from "zustand";
import type { BrowserState } from "../browser/store";
import { activeTabId, newId, pinKeyOf, viewTabIds } from "../browser/model";
import { clickedSelection, dropping, type ClickMods, type Drop } from "../drag/drops";
import type { Tab, TabGroup } from "../browser/types";
import type { PinChoices } from "./pinChoices";
import { groupOf } from "./tabGrouping";
import { placing, type TabPlacement } from "./placing";
import { pinnedGroupMembers } from "../browser/structure";
import { samePage } from "../../lib/url";
import { pinHome } from "./pinHomes";
import { anchorFor, dropNodes, FAVORITES, groupNode, isTabNode, placeNodes, splitNodes, tableOf, tabNode, withLeafPages, type PinPlaces } from "./pinTree";

export type OrganizeSlice = {
  selection: Record<string, string[]>;
  selectionAnchors: Record<string, string>;
  pinChoices: PinChoices;
  pinPlace: PinPlaces;

  setSelection(windowId: string, ids: string[]): void;
  clickTab(windowId: string, tabId: string, mods?: ClickMods): void;
  placeTabs(ids: string[], placement: TabPlacement): void;
  dropTabs(ids: string[], drop: Drop): boolean;
  pinTabs(ids: string[], pinned: boolean, row?: boolean): void;
  returnToPinnedUrl(tabId: string): void;
  separateFromPin(tabId: string): void;
  setPinnedUrl(tabId: string, url?: string): void;
  newFolder(windowId: string, options?: { profileId?: string; parent?: string | null; beforeNode?: string | null; siblings?: string[]; name?: string }): string;
  placePinned(profileId: string, nodes: string[], parent: string | null, beforeNode?: string | null, siblings?: string[]): void;
  dropPinned(profileId: string, nodes: string[]): void;
};

export function selectedTabIds(s: BrowserState, windowId: string): string[] {
  const view = viewTabIds(s, windowId);
  const selected = (s.selection[windowId] ?? []).filter((id) => view.includes(id));
  if (selected.length) return view.filter((id) => selected.includes(id));
  const active = activeTabId(s, windowId);
  return active ? [active] : [];
}

export const awayFromPin = (t: Pick<Tab, "url" | "pinnedUrl">) => !!t.pinnedUrl && !!t.url && !samePage(t.url, t.pinnedUrl);

export function onUrlChange(s: BrowserState, tab: Tab, url: string): Partial<Tab> {
  return tab.pin ? { pinnedUrl: pinHome({ ...tab, url }, true) } : {};
}

export function pruneSelection(selection: Record<string, string[]>, gone: Set<string>): Record<string, string[]> {
  if (!Object.values(selection).some((ids) => ids.some((id) => gone.has(id)))) return selection;
  return Object.fromEntries(Object.entries(selection).map(([w, ids]) => [w, ids.filter((id) => !gone.has(id))]));
}

function openInActiveGroup(s: BrowserState, windowId: string, tabId: string) {
  const active = activeTabId(s, windowId);
  if (!active || active === tabId || s.tabs[tabId]?.pin || s.tabs[active]?.pin) return;
  const group = groupOf(s, active);
  if (group) s.addTabsToGroup(group.id, [tabId]);
  else s.groupTabs([active, tabId]);
}

export const createOrganizeSlice: StateCreator<BrowserState, [], [], OrganizeSlice> = (set, get) => ({
  selection: {},
  selectionAnchors: {},
  pinChoices: {},
  pinPlace: {},

  setSelection(windowId, ids) {
    set((s) => {
      const view = new Set(viewTabIds(s, windowId));
      const next = [...new Set(ids)].filter((id) => view.has(id));
      const prev = s.selection[windowId] ?? [];
      if (next.length === prev.length && next.every((id, i) => id === prev[i])) return {};
      return { selection: { ...s.selection, [windowId]: next } };
    });
  },

  clickTab(windowId, tabId, mods = {}) {
    const s = get();
    const intoGroup = !!mods.altKey && !!mods.shiftKey && !mods.metaKey && s.settings.optShiftClickOpensInGroup;
    const picked = intoGroup ? null : clickedSelection(s, windowId, tabId, mods);
    if (intoGroup) openInActiveGroup(s, windowId, tabId);
    const anchor = picked ? picked.anchor : tabId;
    if (anchor && anchor !== get().selectionAnchors[windowId]) set({ selectionAnchors: { ...get().selectionAnchors, [windowId]: anchor } });
    get().setSelection(windowId, picked?.selection ?? []);
    if (!picked) get().activate(tabId);
  },

  placeTabs(ids, placement) {
    set((s) => placing(s, ids, placement));
  },

  dropTabs(ids, drop) {
    const s = get();
    const next = dropping(s, ids, drop);
    if (next === s) return false;
    set(next);
    return true;
  },

  pinTabs(ids, pinned, row) {
    const s = get();
    const first = s.tabs[ids[0] ?? ""];
    const w = first && s.windows[first.windowId];
    if (!w) return;
    const members = pinnedGroupMembers(s.groups);
    const beforeId = pinned ? null : w.tabIds.find((id) => !s.tabs[id]?.pin && !members.has(id) && !ids.includes(id));
    set(placing(s, ids, { pinned, row, beforeId }));
  },

  returnToPinnedUrl(tabId) {
    const t = get().tabs[tabId];
    if (!t?.pinnedUrl || samePage(t.url, t.pinnedUrl)) return;
    get().navigate(tabId, t.pinnedUrl);
  },

  separateFromPin(tabId) {
    const s = get();
    const t = s.tabs[tabId];
    if (!t || !awayFromPin(t)) return;
    const shown = activeTabId(s, t.windowId, t.profileId) === tabId;
    s.newTab(t.windowId, { url: t.url, profileId: t.profileId, background: !shown, snapshot: { title: t.title, favicon: t.favicon, muted: t.muted, zoom: t.zoom, ...(t.engine ? { engine: t.engine } : {}) } });
    get().returnToPinnedUrl(tabId);
  },

  setPinnedUrl(tabId, url) {
    const t = get().tabs[tabId];
    const next = url ?? t?.url;
    if (!t?.pin || !next) return;
    get().updateTab(tabId, { pinnedUrl: next });
    if (url && !samePage(t.url, url)) get().navigate(tabId, url);
  },

  newFolder(windowId, o = {}) {
    const s = get();
    const w = s.windows[windowId];
    if (!w) return "";
    const profileId = o.profileId ?? w.profileId;
    const id = newId("g");
    const group: TabGroup = { id, windowId, profileId, name: o.name ?? "", icon: null, color: null, collapsed: false, pinned: true, tabIds: [], createdAt: Date.now() };
    const parent = o.parent ?? null;
    const pinPlace = placeNodes(s.pinPlace, profileId, [groupNode(id)], parent, anchorFor(tableOf(s.pinPlace, profileId), o.beforeNode ?? null, parent, o.siblings), o.siblings);
    if (pinPlace === s.pinPlace) return "";
    set({ groups: { ...s.groups, [id]: group }, pinPlace });
    return id;
  },

  placePinned(profileId, nodes, parent, beforeNode = null, siblings) {
    set((s) => {
      const expanded = splitNodes(s, profileId, nodes);
      const paired = nodes.some((node) => splitNodes(s, profileId, [node]).length > 1);
      if (paired && parent === FAVORITES) parent = null;
      nodes = expanded;
      if (beforeNode !== null) beforeNode = splitNodes(s, profileId, [beforeNode])[0] ?? beforeNode;
      const placed = placeNodes(s.pinPlace, profileId, nodes, parent, anchorFor(tableOf(s.pinPlace, profileId), beforeNode, parent, siblings), siblings);
      if (placed === s.pinPlace) return {};
      const byFocus = [...s.ui.focusOrder, ...s.windowOrder].flatMap((id) => (id && s.windows[id]?.tabIds) || []).map((id) => s.tabs[id]);
      const pinnedCopy = (node: string) => byFocus.find((t): t is Tab => !!t && !!t.pin && t.profileId === profileId && !t.liveItem && tabNode(pinKeyOf(t)) === node);
      const entering = nodes.filter(isTabNode).map(pinnedCopy).filter((t): t is Tab => !!t);
      return { pinPlace: withLeafPages(placed, profileId, entering) };
    });
  },

  dropPinned(profileId, nodes) {
    set((s) => {
      const pinPlace = dropNodes(s.pinPlace, profileId, splitNodes(s, profileId, nodes));
      return pinPlace === s.pinPlace ? {} : { pinPlace };
    });
  },

});

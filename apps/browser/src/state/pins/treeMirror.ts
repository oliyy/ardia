import type { BrowserState } from "../browser/store";
import { changedIds } from "../browser/changes";
import { innermostGroupOf } from "../groups/groups";
import { IDLE_LIVE, isIncognitoProfile, makeTab, newId, pinKeyOf, ROW_PIN, samePin, TILE_PIN, without } from "../browser/model";
import { ASLEEP, hasPage, wakeOf, withWake } from "../tabs/pageSession";
import { mapSlotIds, removeFromSplits, splitTabIds, stackAt } from "../splits/splits";
import { removeTabs } from "../tabs/tabs";
import type { ParkedPins, Tab, TabGroup, TabPin } from "../browser/types";
import { samePage } from "../../lib/url";
import { isRegularWindow } from "../windows/small";
import { tileFolderOf } from "./tileFolders";
import { settleParkedPlacement } from "./parkedPins";
import { homeOf, homeTitle, keyField, pinnedGroupsOf, pinsMayDiffer, profilesOf, sectionOf, signature, withSplits } from "./pinMirror";
import { placementMayDiffer, settlePlacement } from "./pinPlacement";
import { anchorUnder, dropNodes, FAVORITES, groupNode, isGroupNode, isTabNode, migratedPlaces, placeNodes, promoteChildren, tableOf, tabNode, withTable, type PinPlace, type PinPlaces, type PinTable } from "./pinTree";

type ParkedTab = ParkedPins["tabs"][number];
type TabSource = { kind: "tab"; tab: Tab } | { kind: "parked"; tab: ParkedTab };
type GroupLook = Pick<TabGroup, "name" | "icon" | "color" | "collapsed">;
type Sources = { tabs: Map<string, TabSource>; groups: Map<string, GroupLook> };

const tabLook = (t: Pick<Tab, "customTitle" | "customIcon" | "pinnedUrl" | "pin">) => `${t.customTitle ?? ""}\u0001${t.customIcon ?? ""}\u0001${t.pinnedUrl ?? ""}\u0001${tileFolderOf(t)?.id ?? ""}\u0001${tileFolderOf(t)?.name ?? ""}\u0001${tileFolderOf(t)?.renamedAt ?? ""}`;
const groupLook = (g: GroupLook) => `${g.name}\u0001${g.icon ?? ""}\u0001${g.color ?? ""}`;

function sourcesOf(s: BrowserState, prev: BrowserState, profileId: string, windowIds: string[], table: PinTable): Sources {
  const tabs = new Map<string, TabSource>();
  const groups = new Map<string, GroupLook>();
  const changedTab = new Set<string>();
  const changedGroup = new Set<string>();
  for (const wid of windowIds) {
    const w = s.windows[wid]!;
    for (const id of w.tabIds) {
      const t = s.tabs[id];
      if (!t || t.profileId !== profileId || t.liveItem) continue;
      const node = tabNode(pinKeyOf(t));
      if (!table[node]) continue;
      const was = prev.tabs[id];
      const changed = !!was && tabLook(was) !== tabLook(t);
      if (!tabs.has(node) || (changed && !changedTab.has(node))) {
        tabs.set(node, { kind: "tab", tab: t });
        if (changed) changedTab.add(node);
      }
    }
    for (const g of Object.values(s.groups)) {
      if (g.windowId !== wid || g.profileId !== profileId || !g.pinned) continue;
      const node = groupNode(pinKeyOf(g));
      if (!table[node]) continue;
      const was = prev.groups[g.id];
      const changed = !!was && groupLook(was) !== groupLook(g);
      if (!groups.has(node) || (changed && !changedGroup.has(node))) {
        groups.set(node, g);
        if (changed) changedGroup.add(node);
      }
    }
  }
  const park = s.parkedPins[profileId];
  for (const p of park?.tabs ?? []) if (table[tabNode(p.id)] && !tabs.has(tabNode(p.id))) tabs.set(tabNode(p.id), { kind: "parked", tab: p });
  for (const g of park?.groups ?? []) if (table[groupNode(g.id)] && !groups.has(groupNode(g.id))) groups.set(groupNode(g.id), g);
  return { tabs, groups };
}

type Role = "tile" | "row" | "leaf";
const roleOf = (table: PinTable, node: string): Role => (table[node]!.parent === FAVORITES ? "tile" : table[node]!.parent === null ? "row" : "leaf");


const tilePinOf = (from: Pick<Tab, "pin">): TabPin => (from.pin?.as === "tile" ? from.pin : TILE_PIN);
const pinForRole = (from: Pick<Tab, "pin">, role: Role): TabPin | null => (role === "tile" ? tilePinOf(from) : role === "row" ? ROW_PIN : null);

function treeCopyOf(src: TabSource, windowId: string, profileId: string, key: string, role: Role, canonical?: PinPlace): Tab {
  const from = src.tab;
  const pinned = role !== "leaf";
  const url = pinned ? homeOf(from) : canonical?.url || from.url;
  const atSource = from.url === url;
  const paired = pinned ? homeTitle(canonical, url) : undefined;
  return {
    ...makeTab(windowId, profileId, url, {
      title: !pinned && canonical?.url ? (canonical.title ?? "") : (paired ?? (atSource ? from.title : "")),
      favicon: atSource ? from.favicon : null,
      pin: pinForRole(from, role),
      pinnedUrl: pinned ? from.pinnedUrl || from.url || null : null,
      customTitle: from.customTitle,
      customIcon: from.customIcon,
      muted: from.muted,
      zoom: from.zoom,
    }),
    pinKey: key,
    page: ASLEEP,
  };
}

function conformWindow(s: BrowserState, windowId: string, profileId: string, table: PinTable, src: Sources): BrowserState {
  const w = s.windows[windowId]!;
  const shown = new Set(Object.values(w.activeTabIds));
  let tabs = s.tabs;
  let live = s.live;
  let groups = s.groups;
  const addedTabs: string[] = [];
  const gone: string[] = [];
  const editTab = (id: string, patch: Partial<Tab>) => {
    const t = tabs[id]!;
    if (Object.entries(patch).every(([k, v]) => t[k as keyof Tab] === v)) return;
    if (tabs === s.tabs) tabs = { ...s.tabs };
    tabs[id] = { ...t, ...patch };
  };
  const demoteOrDrop = (id: string) => {
    const t = tabs[id]!;
    if (hasPage(t) || shown.has(id)) editTab(id, { pin: null, pinnedUrl: null, pinKey: undefined });
    else gone.push(id);
  };
  const byNode = new Map<string, string[]>();
  const memberOfPinned = new Set<string>();
  for (const g of Object.values(s.groups)) if (g.windowId === windowId && g.profileId === profileId && g.pinned) for (const id of g.tabIds) memberOfPinned.add(id);
  for (const id of w.tabIds) {
    const t = s.tabs[id];
    if (!t || t.profileId !== profileId || t.liveItem) continue;
    const node = tabNode(pinKeyOf(t));
    if (table[node]) byNode.set(node, [...(byNode.get(node) ?? []), id]);
    else if (t.pin || memberOfPinned.has(id)) demoteOrDrop(id);
  }
  for (const node of Object.keys(table)) {
    if (!isTabNode(node)) continue;
    const ids = byNode.get(node) ?? [];
    const keep = ids.find((id) => hasPage(s.tabs[id]!)) ?? ids.find((id) => shown.has(id)) ?? ids[0];
    for (const id of ids) if (id !== keep) demoteOrDrop(id);
    const source = src.tabs.get(node);
    const key = node.slice(2);
    if (!keep) {
      if (!source) continue;
      const copy = treeCopyOf(source, windowId, profileId, key, roleOf(table, node), table[node]);
      if (tabs === s.tabs) tabs = { ...s.tabs };
      if (live === s.live) live = { ...s.live };
      tabs[copy.id] = copy;
      live[copy.id] = IDLE_LIVE;
      addedTabs.push(copy.id);
      continue;
    }
    if (source && (source.kind === "parked" || source.tab.id !== keep)) {
      const from = source.tab;
      const role = roleOf(table, node);
      const home = homeOf(from);
      const moveHome = role !== "leaf" && !hasPage(tabs[keep]!) && !samePage(tabs[keep]!.url, home);
      editTab(keep, {
        ...keyField(keep, key),
        customTitle: from.customTitle,
        customIcon: from.customIcon,
        ...(role === "tile" && !samePin(tabs[keep]!.pin, tilePinOf(from)) ? { pin: tilePinOf(from) } : {}),
        ...(role === "leaf" ? {} : { pinnedUrl: from.pinnedUrl || from.url || null }),
        ...(moveHome ? { url: home, title: homeTitle(table[node], home) ?? (from.url === home ? from.title : ""), favicon: from.favicon } : {}),
      });
    } else editTab(keep, keyField(keep, key));
    const canonical = table[node]!;
    const held = tabs[keep]!;
    if (roleOf(table, node) === "leaf" && canonical.url && !hasPage(held) && held.page.kind !== "frozen") {
      if (held.url !== canonical.url) editTab(keep, { url: canonical.url, title: canonical.title ?? "", favicon: null, ...(wakeOf(held) ? { page: withWake(held.page, undefined) } : {}) });
      else if (canonical.title && held.title !== canonical.title) editTab(keep, { title: canonical.title });
    } else if (roleOf(table, node) !== "leaf" && !hasPage(held) && held.page.kind !== "frozen" && held.pinnedUrl && held.url === held.pinnedUrl) {
      const title = homeTitle(canonical, held.pinnedUrl);
      if (title !== undefined && held.title !== title) editTab(keep, { title });
    }
  }
  const groupNodes = new Map<string, string[]>();
  for (const g of Object.values(s.groups)) {
    if (g.windowId !== windowId || g.profileId !== profileId || !g.pinned) continue;
    const node = groupNode(pinKeyOf(g));
    if (table[node]) groupNodes.set(node, [...(groupNodes.get(node) ?? []), g.id]);
    else {
      if (groups === s.groups) groups = { ...s.groups };
      delete groups[g.id];
    }
  }
  for (const node of Object.keys(table)) {
    if (!isGroupNode(node)) continue;
    const ids = groupNodes.get(node) ?? [];
    const [keep, ...extras] = ids;
    for (const id of extras) {
      if (groups === s.groups) groups = { ...s.groups };
      delete groups[id];
    }
    const look = src.groups.get(node);
    const key = node.slice(2);
    if (!keep) {
      if (!look) continue;
      if (groups === s.groups) groups = { ...s.groups };
      const id = groups[key] ? newId("g") : key;
      groups[id] = { id, windowId, profileId, name: look.name, icon: look.icon, color: look.color, collapsed: look.collapsed, pinned: true, tabIds: [], createdAt: Date.now(), ...keyField(id, key) };
      continue;
    }
    const g = groups[keep]!;
    const patch = { name: look?.name ?? g.name, icon: look ? look.icon : g.icon, color: look ? look.color : g.color, ...keyField(keep, key) };
    if (g.name !== patch.name || g.icon !== patch.icon || g.color !== patch.color || g.pinKey !== patch.pinKey) {
      if (groups === s.groups) groups = { ...s.groups };
      groups[keep] = { ...g, ...patch };
    }
  }
  if (tabs === s.tabs && groups === s.groups && !gone.length) return s;
  const window = addedTabs.length ? { ...w, tabIds: [...addedTabs, ...w.tabIds] } : w;
  const next: BrowserState = { ...s, tabs, live, groups, windows: window === w ? s.windows : { ...s.windows, [windowId]: window } };
  return gone.length ? removeTabs(next, gone, false) : next;
}

export function trackHomeTitles(s: Pick<BrowserState, "tabs" | "pinPlace">, prev: Pick<BrowserState, "tabs">): PinPlaces {
  if (s.tabs === prev.tabs) return s.pinPlace;
  let places = s.pinPlace;
  for (const id of changedIds(s.tabs, prev.tabs)) {
    const t = s.tabs[id];
    const was = prev.tabs[id];
    const home = t?.pinnedUrl;
    if (!t || !was || !home || !t.pin || t.liveItem || t.page.kind === "frozen" || was.page.kind === "frozen") continue;
    const table = tableOf(places, t.profileId);
    const node = tabNode(pinKeyOf(t));
    const place = table[node];
    if (!place || (place.parent !== null && place.parent !== FAVORITES)) continue;
    const eligible = hasPage(t) && samePage(t.url, home);
    let title: string;
    if (home !== was.pinnedUrl) {
      if (tableOf(s.pinPlace, t.profileId)[node]?.url === home || (place.url === home && !eligible)) continue;
      title = eligible ? t.title : "";
    } else {
      if (!eligible || t.title === was.title) continue;
      title = t.title;
    }
    if (place.url === home && place.title === title) continue;
    places = withTable(places, t.profileId, { ...table, [node]: { parent: place.parent, pos: place.pos, url: home, title } });
  }
  return places;
}

export function mirrorPins(s: BrowserState, prev: BrowserState): BrowserState | null {
  if (!pinsMayDiffer(s, prev) && s.pinPlace === prev.pinPlace && s.parkedPins === prev.parkedPins) return null;
  const order = [...new Set([...s.ui.focusOrder, ...s.windowOrder])].filter((id) => isRegularWindow(s.windows[id]));
  if (order.length < 2 && !placementMayDiffer(s, prev)) return null;
  const byProfile = new Map<string, string[]>();
  for (const id of order) for (const p of profilesOf(s, s.windows[id]!)) byProfile.set(p, [...(byProfile.get(p) ?? []), id]);
  const folderHolders = new Map<string, string[]>();
  for (const g of Object.values(s.groups)) {
    if (!g.pinned || isIncognitoProfile(g.profileId) || !order.includes(g.windowId)) continue;
    const list = folderHolders.get(g.profileId) ?? [];
    if (!list.includes(g.windowId)) folderHolders.set(g.profileId, [...list, g.windowId]);
  }
  let next = s;
  for (const [profileId, ids] of byProfile) {
    const table = next.pinPlace[profileId];
    if (!table) continue;
    const sourceIds = [...ids, ...(folderHolders.get(profileId) ?? []).filter((id) => !ids.includes(id))];
    const src = sourcesOf(next, prev, profileId, sourceIds, table);
    for (const id of ids) if (next.windows[id]) next = conformWindow(next, id, profileId, table, src);
    if (ids.length < 2 || ![s, prev].some((view) => Object.values(view.splits).some((v) => ids.includes(v.windowId) && splitTabIds(v).some((id) => view.tabs[id]?.profileId === profileId)))) continue;
    const previous = ids.filter((id) => prev.windows[id]);
    const changed = previous.find((id) => signature(withSplits(s, s.windows[id]!, sectionOf(s, s.windows[id]!, profileId, pinnedGroupsOf(s)))) !== signature(withSplits(prev, prev.windows[id]!, sectionOf(prev, prev.windows[id]!, profileId, pinnedGroupsOf(prev)))));
    const sourceId = changed ?? ids.find((id) => Object.values(next.splits).some((v) => v.windowId === id && splitTabIds(v).every((tid) => table[tabNode(pinKeyOf(next.tabs[tid]!))])));
    if (sourceId) {
      const source = withSplits(next, next.windows[sourceId]!, sectionOf(next, next.windows[sourceId]!, profileId, pinnedGroupsOf(next)));
      const wanted = source.splits ?? [];
      for (const id of ids) {
        if (id === sourceId) continue;
        const w = next.windows[id]!;
        const byKey = new Map(w.tabIds.filter((tid) => next.tabs[tid]?.profileId === profileId).map((tid) => [pinKeyOf(next.tabs[tid]!), tid]));
        let splits = next.splits;
        const stale = Object.values(splits).filter((v) => v.windowId === id && splitTabIds(v).every((tid) => table[tabNode(pinKeyOf(next.tabs[tid]!))]) && !wanted.some((x) => splitTabIds(v).map((tid) => pinKeyOf(next.tabs[tid]!)).join() === splitTabIds(x).join()));
        if (stale.length) splits = without(splits, stale.map((v) => v.id));
        for (const v of wanted) {
          const slots = mapSlotIds(v.slots, (key) => byKey.get(key) ?? "");
          const panes = splitTabIds({ slots });
          if (!panes.every(Boolean)) continue;
          const same = Object.values(splits).find((x) => x.windowId === id && splitTabIds(x).join() === panes.join());
          if (same && same.orientation === v.orientation && stackAt(same) === stackAt(v)) continue;
          const key = same?.id ?? newId("split");
          splits = { ...removeFromSplits(splits, new Set(panes)), [key]: { id: key, windowId: id, orientation: v.orientation, slots } };
        }
        if (splits !== next.splits) next = { ...next, splits };
      }
    }
  }
  return next === s ? null : next;
}

export function settlePinHierarchy(s: BrowserState): BrowserState {
  return settleParkedPlacement(settlePlacement(s));
}

export function trackPinStructure(s: BrowserState, prev: BrowserState): BrowserState {
  if (s.pinPlace !== prev.pinPlace || s.groups === prev.groups) return s;
  let pinPlace = s.pinPlace;
  const changed = [...changedIds(s.groups, prev.groups)];
  const source = new Map<string, string>();
  for (const id of changed) {
    const g = s.groups[id];
    const was = prev.groups[id];
    const own = g ?? was;
    if (!own || !s.windows[own.windowId] || !isRegularWindow(s.windows[own.windowId])) continue;
    if (g?.pinned && (!was || g.tabIds !== was.tabIds || g.parentId !== was.parentId || g.pinned !== was.pinned)) source.set(g.profileId, g.windowId);
    if (!was?.pinned || g?.pinned || !tableOf(pinPlace, was.profileId)[groupNode(pinKeyOf(was))]) continue;
    pinPlace = promoteChildren(pinPlace, was.profileId, groupNode(pinKeyOf(was)));
  }
  if (!source.size) return pinPlace === s.pinPlace ? s : { ...s, pinPlace };
  const migrated = migratedPlaces(s, s.pinPlace);
  for (const [profileId, windowId] of source) {
    if (!s.pinPlace[profileId] && migrated[profileId]) {
      pinPlace = withTable(pinPlace, profileId, migrated[profileId]!);
      continue;
    }
    const w = s.windows[windowId]!;
    const at = new Map(w.tabIds.map((id, i) => [id, i]));
    const own = Object.values(s.groups).filter((g) => g.windowId === windowId && g.profileId === profileId && g.pinned);
    const bounds = new Map<string, [number, number]>(own.map((g) => [g.id, g.tabIds.reduce<[number, number]>(([first, last], id) => [Math.min(first, at.get(id) ?? -1), Math.max(last, at.get(id) ?? -1)], [Infinity, -Infinity])]));
    for (const g of [...own].sort((a, z) => bounds.get(z.id)![0]! - bounds.get(a.id)![0]!)) {
      const parent = g.parentId ? s.groups[g.parentId] : undefined;
      const node = groupNode(pinKeyOf(g));
      const target = parent?.pinned ? groupNode(pinKeyOf(parent)) : null;
      const was = prev.groups[g.id];
      if (!tableOf(pinPlace, profileId)[node] || was?.parentId !== g.parentId) {
        const table = tableOf(pinPlace, profileId);
        const last = bounds.get(g.id)![1]!;
        const after = w.tabIds.slice(last + 1).map((id) => {
          const t = s.tabs[id];
          if (!t || t.profileId !== profileId) return null;
          const tab = anchorUnder(table, tabNode(pinKeyOf(t)), target);
          const group = innermostGroupOf(s.groups, id);
          return tab ?? (group?.pinned ? anchorUnder(table, groupNode(pinKeyOf(group)), target) : null);
        }).find((n) => n !== null && n !== node) ?? null;
        pinPlace = placeNodes(pinPlace, profileId, [node], target, after);
      }
    }
    const byParent = new Map<string, { node: string; at: number }[]>();
    for (const g of own) {
      const node = groupNode(pinKeyOf(g));
      const entries = g.tabIds.filter((id) => s.tabs[id] && !s.tabs[id]!.pin && innermostGroupOf(s.groups, id)?.id === g.id).map((id) => ({ node: tabNode(pinKeyOf(s.tabs[id]!)), at: at.get(id) ?? -1 }));
      for (const child of own.filter((x) => x.parentId === g.id)) entries.push({ node: groupNode(pinKeyOf(child)), at: bounds.get(child.id)![0]! });
      byParent.set(node, entries.sort((a, z) => a.at - z.at));
    }
    for (const [parent, entries] of byParent) {
      let before: string | null = null;
      for (const { node } of [...entries].reverse()) {
        const place = tableOf(pinPlace, profileId)[node];
        const old = tableOf(s.pinPlace, profileId)[node];
        const g = own.find((x) => groupNode(pinKeyOf(x)) === parent)!;
        const newGroup = isGroupNode(node) && !Object.values(prev.groups).some((x) => x.windowId === windowId && groupNode(pinKeyOf(x)) === node);
        if (!place || place.parent !== parent || !prev.groups[g.id] || newGroup) pinPlace = placeNodes(pinPlace, profileId, [node], parent, before);
        if (old?.url !== undefined && tableOf(pinPlace, profileId)[node]?.url === undefined) {
          const table = tableOf(pinPlace, profileId);
          pinPlace = withTable(pinPlace, profileId, { ...table, [node]: { ...table[node]!, url: old.url, ...(old.title !== undefined ? { title: old.title } : {}) } });
        }
        before = node;
      }
    }
    for (const id of w.tabIds) {
      const t = s.tabs[id];
      const was = prev.tabs[id];
      if (!t || !was || t.profileId !== profileId || t.pin || innermostGroupOf(s.groups, id)?.pinned) continue;
      if (innermostGroupOf(prev.groups, id)?.pinned) pinPlace = dropNodes(pinPlace, profileId, [tabNode(pinKeyOf(t))]);
    }
  }
  return pinPlace === s.pinPlace ? s : { ...s, pinPlace };
}

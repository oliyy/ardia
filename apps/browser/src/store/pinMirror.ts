import type { BrowserState } from "./browser";
import { changedIds } from "./changes";
import { FAVORITES, anchorUnder, groupNode, migratedPlaces, placementMayDiffer, isGroupNode, isTabNode, pinKeyOf, placeNodes, promoteChildren, dropNodes, settlePlacement, tableOf, tabNode, withTable, type PinPlace, type PinPlaces, type PinTable } from "./pinTree";
import { ancestorIds, depthOf, innermostGroupOf, orderSections, placeBlock, syncGroupOrder, withParent } from "./groups";
import { IDLE_LIVE, isIncognitoProfile, makeTab, newId, pinnedFirst, without } from "./model";
import { settleParkedPlacement } from "./parkedPins";
import { samePage } from "./organize";
import { removeFromSplits } from "./splits";
import { sharedListTab, sharesTabs } from "./tabShare";
import { removeTabs } from "./tabs";
import type { BrowserWindow, ParkedPins, SplitView, Tab, TabGroup } from "./types";

export { pinKeyOf } from "./pinTree";
const homeOf = (t: { url: string; pinnedUrl?: string | null }) => t.pinnedUrl || t.url;
const hasPage = (t: Tab) => !!t.navigation || !!t.adoptId;
export const mirrored = (w: BrowserWindow | undefined): w is BrowserWindow => !!w && !w.incognito && w.kind !== "small";

type Item = { tab: Tab; group: string | null };
type Section = { items: Item[]; groups: Map<string, { group: TabGroup; parent: string | null }>; own: TabGroup[]; duplicate?: boolean; splits?: PinnedSplit[] };
type PinnedSplit = Pick<SplitView, "orientation" | "sizes" | "stack"> & { keys: string[] };

const isTile = (t: Tab) => t.pinned && !t.pinnedAsRow;

function withSplits(s: Pick<BrowserState, "splits">, w: BrowserWindow, x: Section): Section {
  const keyOf = new Map(x.items.filter((i) => !isTile(i.tab)).map((i) => [i.tab.id, pinKeyOf(i.tab)]));
  const splits = Object.values(s.splits)
    .filter((v) => v.windowId === w.id && v.tabIds.every((id) => keyOf.has(id)))
    .map(({ orientation, sizes, stack, tabIds }): PinnedSplit => ({ keys: tabIds.map((id) => keyOf.get(id)!), orientation, sizes, ...(stack ? { stack } : {}) }));
  return { ...x, splits };
}

const splitSig = (v: PinnedSplit) => `S${v.keys.join("\u0003")}\u0001${v.orientation}\u0001${v.stack?.index ?? ""}`;

function innermostPinned(s: Pick<BrowserState, "groups">, own: TabGroup[]): Map<string, TabGroup> {
  const inner = new Map<string, TabGroup>();
  for (const g of own.map((g) => [g, depthOf(s.groups, g.id)] as const).sort((a, z) => a[1] - z[1]).map(([g]) => g)) for (const id of g.tabIds) inner.set(id, g);
  return inner;
}

function pinnedChain(s: Pick<BrowserState, "groups">, g: TabGroup, ownIds: Set<string>): TabGroup[] {
  const up = ancestorIds(s.groups, g.id).filter((id) => ownIds.has(id)).reverse().map((id) => s.groups[id]!);
  return [...up, g];
}

export function sectionOf(s: Pick<BrowserState, "tabs" | "groups">, w: BrowserWindow, profileId: string, pinnedGroups: TabGroup[], member?: (t: Tab) => boolean): Section {
  const mine = pinnedGroups.filter((g) => g.windowId === w.id && g.profileId === profileId);
  const ownIds = new Set(mine.map((g) => g.id));
  const inner = innermostPinned(s, mine);
  const x: Section = { items: [], groups: new Map(), own: [] };
  const owned = new Set<string>();
  for (const id of w.tabIds) {
    const t = s.tabs[id];
    if (!t || t.profileId !== profileId) continue;
    const g = t.pinned ? undefined : inner.get(id);
    if (member ? !member(t) : !t.pinned && !g) continue;
    if (g) {
      for (const c of pinnedChain(s, g, ownIds)) {
        if (owned.has(c.id)) continue;
        owned.add(c.id);
        const key = pinKeyOf(c);
        if (x.groups.has(key)) x.duplicate = true;
        else {
          const p = c.parentId && ownIds.has(c.parentId) ? s.groups[c.parentId]! : undefined;
          x.groups.set(key, { group: c, parent: p ? pinKeyOf(p) : null });
        }
        x.own.push(c);
      }
    }
    x.items.push({ tab: t, group: g ? pinKeyOf(g) : null });
  }
  return x;
}

export function chainOf(x: Pick<Section, "groups">, key: string | null): string[] {
  const out: string[] = [];
  for (let k = key; k && x.groups.has(k) && !out.includes(k); k = x.groups.get(k)!.parent) out.unshift(k);
  return out;
}

const tileSig = (t: Tab) =>
  `${pinKeyOf(t)}\u0001${t.pinnedUrl ?? ""}\u0001${t.customTitle ?? ""}\u0001${t.customIcon ?? ""}\u0001${t.pinnedAsRow ? "r" : ""}\u0001${t.tileFolder?.id ?? ""}\u0001${t.tileFolder?.name ?? ""}\u0001${t.tileFolder?.renamedAt ?? ""}`;
const memberSig = (t: Tab) => `${pinKeyOf(t)}\u0001${t.customTitle ?? ""}\u0001${t.customIcon ?? ""}`;
export function signature(x: Section): string {
  const shown = new Set<string>();
  const lines: string[] = [];
  for (const { tab, group } of x.items) {
    for (const key of chainOf(x, group)) {
      if (shown.has(key)) continue;
      shown.add(key);
      const { group: g, parent } = x.groups.get(key)!;
      lines.push(`G${key}\u0001${g.name}\u0001${g.icon ?? ""}\u0001${g.color ?? ""}\u0001${parent ?? ""}`);
    }
    lines.push(group ? `${memberSig(tab)}\u0002${group}` : tileSig(tab));
  }
  if (x.splits) lines.push(...x.splits.map(splitSig).sort());
  return lines.join("\n");
}

export function profilesOf(s: Pick<BrowserState, "tabs">, w: BrowserWindow): Set<string> {
  const out = new Set<string>();
  for (const id of w.tabIds) {
    const p = s.tabs[id]?.profileId;
    if (p && !isIncognitoProfile(p)) out.add(p);
  }
  return out;
}

const pinnedGroupsOf = (s: Pick<BrowserState, "groups">) => Object.values(s.groups).filter((g) => g.pinned);

export function hasDuplicates(x: Section): boolean {
  const tabs = x.items.map((i) => pinKeyOf(i.tab));
  return !!x.duplicate || new Set(tabs).size < tabs.length;
}

const PIN_FIELDS = ["pinned", "pinnedUrl", "pinnedAsRow", "tileFolder", "customTitle", "customIcon", "profileId", "windowId", "pinKey", "liveItem"] as const;
function pinnedSplitsChanged(s: BrowserState, prev: BrowserState): boolean {
  if (s.splits === prev.splits) return false;
  const members = new Set(pinnedGroupsOf(s).flatMap((g) => g.tabIds));
  const pinnedPane = (id: string) => !!s.tabs[id]?.pinned || !!prev.tabs[id]?.pinned || members.has(id);
  return [...Object.values(s.splits), ...Object.values(prev.splits)].some((v) => v.tabIds.some(pinnedPane));
}

function pinsMayDiffer(s: BrowserState, prev: BrowserState): boolean {
  if (s.windows !== prev.windows || s.groups !== prev.groups || pinnedSplitsChanged(s, prev)) return true;
  if (s.tabs === prev.tabs) return false;
  let members: Set<string> | null = null;
  for (const id of changedIds(s.tabs, prev.tabs)) {
    const a = s.tabs[id];
    const b = prev.tabs[id];
    if (!a || !b) {
      if (a?.pinned || b?.pinned) return true;
      members ??= new Set(pinnedGroupsOf(s).flatMap((g) => g.tabIds));
      if (members.has(id)) return true;
      continue;
    }
    if (PIN_FIELDS.some((f) => a[f] !== b[f])) return true;
  }
  return false;
}

const lastIndex = <T>(xs: T[], test: (x: T) => boolean) => {
  for (let i = xs.length - 1; i >= 0; i--) if (test(xs[i]!)) return i;
  return -1;
};

export function union(sections: Section[], samePages = true): Section {
  const spec: Section = { items: [], groups: new Map(), own: [] };
  const keys = new Set<string>();
  const within = (item: Item, key: string) => chainOf(spec, item.group).includes(key);
  const lastIn = (key: string) => lastIndex(spec.items, (i) => within(i, key));
  for (const x of sections) {
    const earlier = spec.items.filter((i) => !i.group).map((i) => i.tab);
    const paired = new Set((x.splits ?? []).flatMap((v) => v.keys));
    for (const [key, g] of x.groups) if (!spec.groups.has(key)) spec.groups.set(key, g);
    let anchor = -1;
    for (const item of x.items) {
      const key = pinKeyOf(item.tab);
      if (keys.has(key)) {
        anchor = spec.items.findIndex((i) => pinKeyOf(i.tab) === key);
        continue;
      }
      if (samePages && !item.group && !paired.has(key) && earlier.some((o) => samePage(homeOf(o), homeOf(item.tab)))) continue;
      keys.add(key);
      const host = chainOf(spec, item.group).reverse().find((k) => lastIn(k) >= 0);
      const at = host
        ? anchor >= 0 && within(spec.items[anchor]!, host) ? anchor : lastIn(host)
        : anchor >= 0 ? anchor : item.group ? spec.items.length - 1 : lastIndex(spec.items, (i) => !i.group);
      spec.items.splice(at + 1, 0, item);
      anchor = at + 1;
    }
    if (x.splits) spec.splits ??= [];
    for (const v of x.splits ?? []) if (!spec.splits!.some((u) => u.keys.some((k) => v.keys.includes(k)))) spec.splits!.push(v);
  }
  return spec;
}

export function treeOrder(x: Pick<Section, "items" | "groups">): Item[] {
  const kids = new Map<string | null, (Item | string)[]>();
  const add = (parent: string | null, node: Item | string) => kids.set(parent, [...(kids.get(parent) ?? []), node]);
  const seen = new Set<string>();
  for (const item of x.items) {
    const chain = chainOf(x, item.group);
    add(chain.at(-1) ?? null, item);
    for (let i = chain.length - 1; i >= 0 && !seen.has(chain[i]!); i--) {
      seen.add(chain[i]!);
      add(chain[i - 1] ?? null, chain[i]!);
    }
  }
  const flat = (parent: string | null): Item[] => (kids.get(parent) ?? []).flatMap((n) => (typeof n === "string" ? flat(n) : [n]));
  return flat(null);
}

export const keyField = (id: string, key: string) => (id === key ? { pinKey: undefined } : { pinKey: key });

export function copyOf(src: Tab, windowId: string, tile: boolean): Tab {
  const url = tile ? homeOf(src) : src.url;
  const atSource = samePage(src.url, url);
  return {
    ...makeTab(windowId, src.profileId, url, {
      title: atSource ? src.title : "",
      favicon: atSource ? src.favicon : null,
      pinned: tile,
      pinnedUrl: tile ? src.pinnedUrl || src.url || null : null,
      ...(tile && src.pinnedAsRow ? { pinnedAsRow: true as const } : {}),
      ...(tile && !src.pinnedAsRow && src.tileFolder ? { tileFolder: src.tileFolder } : {}),
      customTitle: src.customTitle,
      customIcon: src.customIcon,
      muted: src.muted,
      zoom: src.zoom,
    }),
    pinKey: pinKeyOf(src),
    navigation: null,
    unloaded: true,
  };
}

export function settleMovedPins(before: BrowserState, after: BrowserState, moved: string[], targetId: string): BrowserState {
  if (!mirrored(after.windows[targetId])) return after;
  const memberOf = innermostPinned(before, pinnedGroupsOf(before));
  const pins = moved
    .map((id) => before.tabs[id])
    .filter((t): t is Tab => !!t && (t.pinned || memberOf.has(t.id) || sharedListTab(before, t)) && t.windowId !== targetId && after.tabs[t.id]?.windowId === targetId);
  if (!pins.length) return after;
  const tabs = { ...after.tabs };
  const live = { ...after.live };
  const windows = { ...after.windows };
  const groups = { ...after.groups };
  for (const sourceId of new Set(pins.map((t) => t.windowId))) {
    const src = windows[sourceId];
    if (!mirrored(src) || !mirrored(before.windows[sourceId])) continue;
    const swap = new Map<string, string>();
    const shown = before.windows[sourceId]!.activeTabIds;
    let activeTabIds = src.activeTabIds;
    for (const t of pins) {
      if (t.windowId !== sourceId) continue;
      const copy = copyOf(t, sourceId, t.pinned);
      tabs[copy.id] = copy;
      live[copy.id] = IDLE_LIVE;
      swap.set(t.id, copy.id);
      if (shown[t.profileId] === t.id && !t.pinned && !memberOf.has(t.id)) activeTabIds = { ...activeTabIds, [t.profileId]: copy.id };
    }
    const present = new Set([...src.tabIds, ...swap.values()]);
    const keep = (ids: string[]) => ids.map((id) => swap.get(id) ?? id).filter((id) => present.has(id));
    for (const g of sharesTabs(before) ? Object.values(before.groups) : pinnedGroupsOf(before)) {
      if (g.windowId === sourceId && g.tabIds.some((id) => swap.has(id))) groups[g.id] = { ...g, ...groups[g.id], tabIds: keep(g.tabIds) };
    }
    windows[sourceId] = { ...src, tabIds: pinnedFirst(keep(before.windows[sourceId]!.tabIds), tabs, groups), ...(activeTabIds !== src.activeTabIds ? { activeTabIds } : {}) };
  }
  const target = windows[targetId]!;
  let tabIds = [...target.tabIds];
  const gone: string[] = [];
  for (const m of pins) {
    const g = memberOf.get(m.id);
    if (!g) continue;
    const own = Object.values(groups).find((x) => x.pinned && x.windowId === targetId && x.profileId === m.profileId && pinKeyOf(x) === pinKeyOf(g));
    const copy = own?.tabIds.find((id) => tabs[id] && pinKeyOf(tabs[id]!) === pinKeyOf(m));
    if (!own || !copy) continue;
    for (const x of Object.values(groups)) if (x.windowId === targetId && x.tabIds.includes(copy)) groups[x.id] = { ...x, tabIds: x.tabIds.map((id) => (id === copy ? m.id : id)) };
    tabIds = tabIds.filter((id) => id !== m.id);
    tabIds[tabIds.indexOf(copy)] = m.id;
    if (hasPage(tabs[copy]!) || Object.values(target.activeTabIds).includes(copy)) {
      tabs[copy] = { ...tabs[copy]!, pinKey: undefined };
      tabIds.push(copy);
    } else gone.push(copy);
  }
  windows[targetId] = { ...target, tabIds: orderSections(pinnedFirst(tabIds, tabs, groups), tabs, groups) };
  const next: BrowserState = { ...after, tabs, live, windows, groups };
  return gone.length ? removeTabs(next, gone, false) : next;
}

type ParkedTab = ParkedPins["tabs"][number];
type TabSource = { kind: "tab"; tab: Tab } | { kind: "parked"; tab: ParkedTab };
type GroupLook = Pick<TabGroup, "name" | "icon" | "color" | "collapsed">;
type Sources = { tabs: Map<string, TabSource>; groups: Map<string, GroupLook> };

const tabLook = (t: Pick<Tab, "customTitle" | "customIcon" | "pinnedUrl" | "tileFolder">) => `${t.customTitle ?? ""}\u0001${t.customIcon ?? ""}\u0001${t.pinnedUrl ?? ""}\u0001${t.tileFolder?.id ?? ""}\u0001${t.tileFolder?.name ?? ""}\u0001${t.tileFolder?.renamedAt ?? ""}`;
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

export const homeTitle = (place: PinPlace | undefined, home: string) => (place?.url === home && place.title !== undefined ? place.title : undefined);

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
      pinned,
      pinnedUrl: pinned ? from.pinnedUrl || from.url || null : null,
      ...(role === "row" ? { pinnedAsRow: true as const } : {}),
      ...(role === "tile" && from.tileFolder ? { tileFolder: from.tileFolder } : {}),
      customTitle: from.customTitle,
      customIcon: from.customIcon,
      muted: from.muted,
      zoom: from.zoom,
    }),
    pinKey: key,
    navigation: null,
    unloaded: true,
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
    if (hasPage(t) || shown.has(id)) editTab(id, { pinned: false, pinnedUrl: null, pinnedAsRow: undefined, tileFolder: undefined, pinKey: undefined });
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
    else if (t.pinned || memberOfPinned.has(id)) demoteOrDrop(id);
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
        tileFolder: role === "tile" ? from.tileFolder : undefined,
        ...(role === "leaf" ? {} : { pinnedUrl: from.pinnedUrl || from.url || null }),
        ...(moveHome ? { url: home, title: homeTitle(table[node], home) ?? (from.url === home ? from.title : ""), favicon: from.favicon } : {}),
      });
    } else editTab(keep, keyField(keep, key));
    const canonical = table[node]!;
    const held = tabs[keep]!;
    if (roleOf(table, node) === "leaf" && canonical.url && !hasPage(held) && !held.pageIn) {
      if (held.url !== canonical.url) editTab(keep, { url: canonical.url, title: canonical.title ?? "", favicon: null, wakeAdoptId: undefined });
      else if (canonical.title && held.title !== canonical.title) editTab(keep, { title: canonical.title });
    } else if (roleOf(table, node) !== "leaf" && !hasPage(held) && !held.pageIn && held.pinnedUrl && held.url === held.pinnedUrl) {
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
    if (!t || !was || !home || !t.pinned || t.liveItem || t.pageIn || was.pageIn) continue;
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
  const order = [...new Set([...s.ui.focusOrder, ...s.windowOrder])].filter((id) => mirrored(s.windows[id]));
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
    if (ids.length < 2 || ![s, prev].some((view) => Object.values(view.splits).some((v) => ids.includes(v.windowId) && v.tabIds.some((id) => view.tabs[id]?.profileId === profileId)))) continue;
    const previous = ids.filter((id) => prev.windows[id]);
    const changed = previous.find((id) => signature(withSplits(s, s.windows[id]!, sectionOf(s, s.windows[id]!, profileId, pinnedGroupsOf(s)))) !== signature(withSplits(prev, prev.windows[id]!, sectionOf(prev, prev.windows[id]!, profileId, pinnedGroupsOf(prev)))));
    const sourceId = changed ?? ids.find((id) => Object.values(next.splits).some((v) => v.windowId === id && v.tabIds.every((tid) => table[tabNode(pinKeyOf(next.tabs[tid]!))])));
    if (sourceId) {
      const source = withSplits(next, next.windows[sourceId]!, sectionOf(next, next.windows[sourceId]!, profileId, pinnedGroupsOf(next)));
      const wanted = source.splits ?? [];
      for (const id of ids) {
        if (id === sourceId) continue;
        const w = next.windows[id]!;
        const byKey = new Map(w.tabIds.filter((tid) => next.tabs[tid]?.profileId === profileId).map((tid) => [pinKeyOf(next.tabs[tid]!), tid]));
        let splits = next.splits;
        const stale = Object.values(splits).filter((v) => v.windowId === id && v.tabIds.every((tid) => table[tabNode(pinKeyOf(next.tabs[tid]!))]) && !wanted.some((x) => v.tabIds.map((tid) => pinKeyOf(next.tabs[tid]!)).join() === x.keys.join()));
        if (stale.length) splits = without(splits, stale.map((v) => v.id));
        for (const v of wanted) {
          const panes = v.keys.map((key) => byKey.get(key) ?? "");
          if (!panes.every(Boolean)) continue;
          const same = Object.values(splits).find((x) => x.windowId === id && x.tabIds.join() === panes.join());
          if (same && same.orientation === v.orientation && same.stack?.index === v.stack?.index) continue;
          const key = same?.id ?? newId("split");
          splits = { ...removeFromSplits(splits, new Set(panes)), [key]: { id: key, windowId: id, tabIds: panes, orientation: v.orientation, sizes: v.sizes, ...(v.stack ? { stack: v.stack } : {}) } };
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
    if (!own || !s.windows[own.windowId] || !mirrored(s.windows[own.windowId])) continue;
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
      const entries = g.tabIds.filter((id) => s.tabs[id] && !s.tabs[id]!.pinned && innermostGroupOf(s.groups, id)?.id === g.id).map((id) => ({ node: tabNode(pinKeyOf(s.tabs[id]!)), at: at.get(id) ?? -1 }));
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
      if (!t || !was || t.profileId !== profileId || t.pinned || innermostGroupOf(s.groups, id)?.pinned) continue;
      if (innermostGroupOf(prev.groups, id)?.pinned) pinPlace = dropNodes(pinPlace, profileId, [tabNode(pinKeyOf(t))]);
    }
  }
  return pinPlace === s.pinPlace ? s : { ...s, pinPlace };
}

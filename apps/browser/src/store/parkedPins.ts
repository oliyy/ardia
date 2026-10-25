import type { BrowserState } from "./browser";
import { ancestorIds, depthOf, orderSections, placeBlock, syncGroupOrder, withParent } from "./groups";
import { IDLE_LIVE, isIncognitoProfile, makeTab, newId, pendingRestore, pinnedFirst, restoreId, snapshotTab, without } from "./model";
import { samePage } from "./organize";
import { homeTitle, pinKeyOf } from "./pinMirror";
import { FAVORITES, groupNode, isGroupNode, isTabNode, keyOfNode, migratedPlaces, pinTree, tableOf, tabNode, walkTree } from "./pinTree";
import type { BrowserWindow, HistoryEntry, ParkedPins, Tab, TabGroup } from "./types";


type PinSource = Pick<BrowserState, "tabs" | "groups" | "history"> & Partial<Pick<BrowserState, "windows" | "splits">>;

function atPin(t: Tab, history: HistoryEntry[]): Partial<Pick<Tab, "url" | "title" | "favicon">> {
  const home = t.pinnedUrl;
  if (!home || !t.url || samePage(t.url, home)) return {};
  const entry = history.find((h) => samePage(h.url, home));
  return { url: home, title: entry?.title ?? t.title, favicon: entry?.favicon ?? t.favicon };
}

const homeOf = (t: { url: string; pinnedUrl?: string | null }) => t.pinnedUrl || t.url;

export function parkWindowPins(parked: Record<string, ParkedPins>, w: BrowserWindow, s: PinSource): Record<string, ParkedPins> {
  if (w.incognito) return parked;
  const own = Object.values(s.groups).filter((g) => g.pinned && g.windowId === w.id);
  const ownIds = new Set(own.map((g) => g.id));
  const groupOf = new Map<string, TabGroup>();
  for (const g of own.map((g) => [g, depthOf(s.groups, g.id)] as const).sort((a, z) => a[1] - z[1]).map(([g]) => g)) for (const id of g.tabIds) groupOf.set(id, g);
  let next = parked;
  const profiles = new Set([...w.tabIds.map((id) => s.tabs[id]?.profileId), ...own.map((g) => g.profileId)].filter((p): p is string => !!p));
  const holdsFolder = (windowId: string, profileId: string) => Object.values(s.groups).some((g) => g.pinned && g.windowId === windowId && g.profileId === profileId);
  const shownElsewhere = (profileId: string) =>
    Object.values(s.windows ?? {}).some(
      (o) => o.id !== w.id && !o.incognito && o.kind !== "small" && (o.tabIds.some((id) => s.tabs[id]?.profileId === profileId) || holdsFolder(o.id, profileId)),
    );
  for (const profileId of profiles) {
    if (shownElsewhere(profileId)) continue;
    const own = w.tabIds.map((id) => s.tabs[id]).filter((t): t is Tab => !!t && t.profileId === profileId);
    const ownFolders = Object.values(s.groups).filter((g) => g.pinned && g.windowId === w.id).filter((g) => g.profileId === profileId);
    if (!own.some((t) => t.pinned || groupOf.has(t.id)) && !ownFolders.length) continue;
    const old = next[profileId] ?? { tabs: [], groups: [] };
    const ids = new Set(old.tabs.map((p) => p.id));
    const homes = old.tabs.filter((p) => !p.groupId).map(homeOf);
    const groups = [...old.groups];
    for (const g of ownFolders) {
      if (groups.some((x) => x.id === pinKeyOf(g))) continue;
      const parent = g.parentId ? s.groups[g.parentId] : undefined;
      groups.push({ id: pinKeyOf(g), name: g.name, icon: g.icon, color: g.color, collapsed: g.collapsed, ...(parent?.pinned ? { parentId: pinKeyOf(parent) } : {}) });
    }
    const tiles: ParkedPins["tabs"] = [];
    const rest: ParkedPins["tabs"] = [];
    const paneIds = new Map<string, string>();
    const splitPanes = new Set(Object.values(s.splits ?? {}).filter((v) => v.windowId === w.id).flatMap((v) => v.tabIds));
    const pending = (t: Tab, moved: boolean) => {
      const from = !moved && !isIncognitoProfile(t.profileId) ? pendingRestore(t) : undefined;
      return from ? { restoreFrom: from } : {};
    };
    for (const t of own) {
      if (t.pinned ? t.pinnedAsRow : groupOf.has(t.id)) paneIds.set(t.id, pinKeyOf(t));
      if (ids.has(pinKeyOf(t))) continue;
      const g = t.pinned ? undefined : groupOf.get(t.id);
      if (t.pinned) {
        const back = atPin(t, s.history[profileId] ?? []);
        const tile = { ...snapshotTab(t), ...back, ...pending(t, !!back.url), id: pinKeyOf(t), groupId: null };
        if (!splitPanes.has(t.id) && homes.some((h) => samePage(h, homeOf(tile)))) {
          paneIds.delete(t.id);
          continue;
        }
        homes.push(homeOf(tile));
        (t.pinnedAsRow ? rest : tiles).push(tile);
      } else if (g) {
        const chain = [...ancestorIds(s.groups, g.id).filter((id) => ownIds.has(id)).reverse().map((id) => s.groups[id]!), g];
        chain.forEach((x, i) => {
          if (groups.some((y) => y.id === pinKeyOf(x))) return;
          const parent = chain[i - 1];
          groups.push({ id: pinKeyOf(x), name: x.name, icon: x.icon, color: x.color, collapsed: x.collapsed, ...(parent ? { parentId: pinKeyOf(parent) } : {}) });
        });
        rest.push({ ...snapshotTab(t), ...pending(t, false), id: pinKeyOf(t), groupId: pinKeyOf(g) });
      }
    }
    const isTile = (p: ParkedPins["tabs"][number]) => !p.groupId && !p.pinnedAsRow;
    const splits = [...(old.splits ?? [])];
    for (const v of Object.values(s.splits ?? {})) {
      if (v.windowId !== w.id || !v.tabIds.every((id) => paneIds.has(id))) continue;
      const parkedIds = v.tabIds.map((id) => paneIds.get(id)!);
      if (splits.some((x) => x.ids.some((id) => parkedIds.includes(id)))) continue;
      splits.push({ ids: parkedIds, orientation: v.orientation, sizes: v.sizes, ...(v.stack ? { stack: v.stack } : {}) });
    }
    const tabs = [...old.tabs.filter(isTile), ...tiles, ...old.tabs.filter((p) => !isTile(p)), ...rest];
    next = { ...next, [profileId]: { tabs, groups, ...(splits.length ? { splits } : {}) } };
  }
  return next;
}

export function adoptParkedPins(s: BrowserState, windowId: string, profileId: string): BrowserState {
  const park = s.parkedPins[profileId];
  const w = s.windows[windowId];
  if (!park || !w || w.incognito || !s.profiles[profileId]) return s;
  if (!s.pinPlace[profileId]) s = { ...s, pinPlace: migratedPlaces(s, s.pinPlace) };
  const tabs = { ...s.tabs };
  const live = { ...s.live };
  const homes = w.tabIds.map((id) => tabs[id]).filter((t): t is Tab => !!t?.pinned && t.profileId === profileId).map(homeOf);
  const keyOf = new Map<string, string>();
  const tabOf = new Map<string, string>();
  const added: string[] = [];
  const splitPanes = new Set((park.splits ?? []).flatMap((v) => v.ids));
  const table = tableOf(s.pinPlace, profileId);
  for (const { id, groupId, restoreFrom, ...snap } of park.tabs) {
    const home = homeOf(snap);
    if (!groupId && !splitPanes.has(id) && homes.some((h) => samePage(h, home))) continue;
    const paired = !groupId && samePage(snap.url, home) ? homeTitle(table[tabNode(id)], home) : undefined;
    const tab: Tab = {
      ...makeTab(windowId, profileId, snap.url, { ...snap, ...(paired !== undefined ? { title: paired } : {}), profileId, pinned: !groupId, pinnedUrl: groupId ? null : home || null }),
      ...(tabs[id] ? { id: newId("tab"), pinKey: id } : { id }),
      navigation: null,
      unloaded: true,
      ...(restoreFrom && !tabs[id] ? { wakeAdoptId: restoreId(restoreFrom) } : {}),
    };
    tabs[tab.id] = tab;
    live[tab.id] = IDLE_LIVE;
    added.push(tab.id);
    tabOf.set(id, tab.id);
    if (groupId) keyOf.set(tab.id, groupId);
  }
  const parentOf = new Map(park.groups.map((g) => [g.id, g.parentId]));
  const within = (key: string | undefined, target: string) => {
    const seen = new Set<string>();
    for (let k = key; k && !seen.has(k); k = parentOf.get(k)) {
      if (k === target) return true;
      seen.add(k);
    }
    return false;
  };
  let groups = { ...s.groups };
  const idOf = new Map<string, string>();
  for (const { parentId: _, ...g } of park.groups) {
    const tabIds = added.filter((id) => within(keyOf.get(id), g.id));
    const id = groups[g.id] ? newId("g") : g.id;
    idOf.set(g.id, id);
    groups[id] = { ...g, id, ...(id === g.id ? {} : { pinKey: g.id }), windowId, profileId, pinned: true, tabIds, createdAt: Date.now() };
  }
  for (const g of park.groups) {
    const id = idOf.get(g.id);
    const parent = g.parentId ? idOf.get(g.parentId) : undefined;
    if (id && parent) groups[id] = withParent(groups[id]!, parent);
  }
  let splits = s.splits;
  let order = [...added, ...w.tabIds];
  for (const v of park.splits ?? []) {
    const panes = v.ids.map((id) => tabOf.get(id) ?? "");
    if (!panes.every(Boolean)) continue;
    const id = newId("split");
    splits = { ...splits, [id]: { id, windowId, tabIds: panes, orientation: v.orientation, sizes: v.sizes, ...(v.stack ? { stack: v.stack } : {}) } };
    order = placeBlock(order, order.filter((x) => panes.includes(x)));
  }
  const window = { ...w, tabIds: orderSections(pinnedFirst(order, tabs, groups), tabs, groups) };
  groups = syncGroupOrder(groups, window);
  return { ...s, tabs, live, groups, splits, windows: { ...s.windows, [windowId]: window }, parkedPins: without(s.parkedPins, [profileId]) };
}

export function settleParkedPlacement(s: BrowserState): BrowserState {
  let parkedPins = s.parkedPins;
  for (const [profileId, park] of Object.entries(s.parkedPins)) {
    const table = tableOf(s.pinPlace, profileId);
    const tabKeys = new Set(park.tabs.map((t) => t.id));
    const groupKeys = new Set(park.groups.map((g) => g.id));
    const tree = pinTree(table, (node) => isTabNode(node) ? tabKeys.has(keyOfNode(node)) : isGroupNode(node) ? groupKeys.has(keyOfNode(node)) : true);
    const order: string[] = [];
    walkTree(tree, FAVORITES, (node) => { if (isTabNode(node)) order.push(keyOfNode(node)); });
    walkTree(tree, null, (node) => { if (isTabNode(node)) order.push(keyOfNode(node)); });
    const rank = new Map(order.map((key, i) => [key, i]));
    const tabs = park.tabs.map((t) => {
      const node = tabNode(t.id);
      if (!tree.parent.has(node)) return t;
      const parent = tree.parent.get(node) ?? null;
      const groupId = parent && isGroupNode(parent) ? keyOfNode(parent) : null;
      const row = parent === null;
      if (groupId === t.groupId && !!t.pinnedAsRow === row) return t;
      const { pinnedAsRow: _, tileFolder, ...rest } = t;
      return { ...rest, groupId, pinned: groupId === null, pinnedUrl: groupId ? null : t.pinnedUrl || t.url || null, ...(row ? { pinnedAsRow: true as const } : {}), ...(parent === FAVORITES && tileFolder ? { tileFolder } : {}) };
    }).sort((a, z) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(z.id) ?? Number.MAX_SAFE_INTEGER));
    const groups = park.groups.map((g) => {
      const parent = tree.parent.get(groupNode(g.id));
      const parentId = parent && isGroupNode(parent) ? keyOfNode(parent) : undefined;
      if (parentId === g.parentId) return g;
      const { parentId: _, ...rest } = g;
      return { ...rest, ...(parentId ? { parentId } : {}) };
    });
    if (tabs.every((t, i) => t === park.tabs[i]) && groups.every((g, i) => g === park.groups[i])) continue;
    if (parkedPins === s.parkedPins) parkedPins = { ...parkedPins };
    parkedPins[profileId] = { ...park, tabs, groups };
  }
  return parkedPins === s.parkedPins ? s : { ...s, parkedPins };
}

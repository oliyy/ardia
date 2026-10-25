import { assignPositions } from "@ardia/sync";
import type { BrowserState } from "./browser";
import { changedIds } from "./changes";
import type { BrowserWindow, ParkedPins, Tab, TabGroup } from "./types";

export type PinPlace = { parent: string | null; pos: string; url?: string; title?: string };
export type PinTable = Record<string, PinPlace>;
export type PinPlaces = Record<string, PinTable>;

export const FAVORITES = "fav";

type Keyed = { id: string; pinKey?: string };
export const pinKeyOf = (x: Keyed) => x.pinKey ?? x.id;
export const tabNode = (key: string) => `t:${key}`;
export const groupNode = (key: string) => `g:${key}`;
export const liveNode = (id: string) => `l:${id}`;
export const isTabNode = (node: string) => node.startsWith("t:");
export const isGroupNode = (node: string) => node.startsWith("g:");
export const isLiveNode = (node: string) => node.startsWith("l:");
export const keyOfNode = (node: string) => node.slice(2);

const NO_TABLE: PinTable = {};

const inFolder = (parent: string | null | undefined) => !!parent && isGroupNode(parent);
export function placedAt(was: PinPlace | undefined, parent: string | null, pos: string): PinPlace {
  if (!was || inFolder(was.parent) !== inFolder(parent) || was.url === undefined) return { parent, pos };
  return { parent, pos, url: was.url, ...(was.title !== undefined ? { title: was.title } : {}) };
}
export const tableOf = (places: PinPlaces, profileId: string): PinTable => places[profileId] ?? NO_TABLE;

const byPlace = (table: PinTable) => (a: string, z: string) => {
  const pa = table[a]?.pos ?? "";
  const pz = table[z]?.pos ?? "";
  if (pa !== pz) return pa < pz ? -1 : 1;
  return a < z ? -1 : a > z ? 1 : 0;
};

export function siblingsOf(table: PinTable, parent: string | null): string[] {
  return Object.keys(table)
    .filter((n) => table[n]!.parent === parent)
    .sort(byPlace(table));
}

export function descendantsOf(table: PinTable, nodes: string[]): string[] {
  const out: string[] = [];
  const seen = new Set(nodes);
  let frontier = nodes.filter(isGroupNode);
  while (frontier.length) {
    const parents = new Set(frontier);
    frontier = [];
    for (const [n, p] of Object.entries(table)) {
      if (p.parent === null || !parents.has(p.parent) || seen.has(n)) continue;
      seen.add(n);
      out.push(n);
      if (isGroupNode(n)) frontier.push(n);
    }
  }
  return out;
}

export type PinTree = { parent: Map<string, string | null>; children: Map<string | null, string[]> };

export function pinTree(table: PinTable, exists: (node: string) => boolean, extraRoot: string[] = []): PinTree {
  const nodes = Object.keys(table).filter(exists);
  const present = new Set(nodes);
  const parent = new Map<string, string | null>();
  for (const n of nodes) {
    const p = table[n]!.parent;
    if (p === FAVORITES) parent.set(n, isTabNode(n) ? FAVORITES : null);
    else if (p === null || !isGroupNode(p) || !present.has(p)) parent.set(n, null);
    else parent.set(n, p);
  }
  const settled = new Set<string>();
  for (const n of nodes) {
    const path: string[] = [];
    const onPath = new Set<string>();
    let cur: string | null = n;
    while (cur !== null && cur !== FAVORITES && !settled.has(cur)) {
      if (onPath.has(cur)) {
        const cycle = path.slice(path.indexOf(cur));
        const cut = [...cycle].sort()[0]!;
        parent.set(cut, null);
        break;
      }
      onPath.add(cur);
      path.push(cur);
      cur = parent.get(cur) ?? null;
    }
    for (const p of path) settled.add(p);
  }
  const children = new Map<string | null, string[]>();
  for (const n of nodes) {
    const p = parent.get(n) ?? null;
    const list = children.get(p);
    if (list) list.push(n);
    else children.set(p, [n]);
  }
  const order = byPlace(table);
  for (const list of children.values()) list.sort(order);
  const extra = extraRoot.filter((n) => !present.has(n));
  if (extra.length) {
    for (const n of extra) parent.set(n, null);
    children.set(null, [...(children.get(null) ?? []), ...extra]);
  }
  return { parent, children };
}

export function walkTree(tree: PinTree, from: string | null, visit: (node: string, depth: number) => boolean | void, depth = 0): void {
  for (const n of tree.children.get(from) ?? []) {
    if (visit(n, depth) === false) continue;
    if (isGroupNode(n)) walkTree(tree, n, visit, depth + 1);
  }
}

export function displayedSubtree(tree: PinTree, root: string): string[] {
  const out = [root];
  const visit = (n: string) => {
    for (const child of tree.children.get(n) ?? []) {
      out.push(child);
      if (isGroupNode(child)) visit(child);
    }
  };
  visit(root);
  return out;
}

export function ancestorsOf(tree: PinTree, node: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let cur = tree.parent.get(node) ?? null;
  while (cur !== null && cur !== FAVORITES && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    cur = tree.parent.get(cur) ?? null;
  }
  return out;
}

export function anchorUnder(table: PinTable, node: string | null, parent: string | null): string | null {
  const seen = new Set<string>();
  let cur = node;
  while (cur !== null && table[cur] && !seen.has(cur)) {
    if (table[cur]!.parent === parent) return cur;
    seen.add(cur);
    const up = table[cur]!.parent;
    if (up === null || up === FAVORITES) return null;
    cur = up;
  }
  return null;
}

export function anchorFor(table: PinTable, node: string | null, parent: string | null, siblings?: string[]): string | null {
  if (node !== null && siblings?.includes(node)) return node;
  return anchorUnder(table, node, parent);
}

export function withTable(places: PinPlaces, profileId: string, table: PinTable): PinPlaces {
  if (places[profileId] === table) return places;
  if (!Object.keys(table).length && !places[profileId]) return places;
  return { ...places, [profileId]: table };
}

export function placeNodes(
  places: PinPlaces,
  profileId: string,
  nodes: string[],
  parent: string | null,
  before: string | null,
  shown?: string[],
): PinPlaces {
  const table = tableOf(places, profileId);
  const moving = [...new Set(nodes)].filter((n) => (parent === FAVORITES ? isTabNode(n) : true));
  if (!moving.length) return places;
  if (parent !== null && parent !== FAVORITES) {
    if (!isGroupNode(parent) || moving.includes(parent)) return places;
    const below = new Set(descendantsOf(table, moving));
    if (below.has(parent)) return places;
  }
  const movingSet = new Set(moving);
  const base = (shown ?? siblingsOf(table, parent)).filter((n) => !movingSet.has(n));
  const at = before !== null && base.includes(before) ? base.indexOf(before) : base.length;
  const seq = [...base.slice(0, at), ...moving, ...base.slice(at)];
  const positions = assignPositions(seq.map((n) => (movingSet.has(n) ? undefined : table[n]?.pos)));
  let next: PinTable | null = null;
  seq.forEach((n, i) => {
    const was = table[n];
    if (!movingSet.has(n) && was && was.parent !== parent) return;
    if (was && was.parent === parent && was.pos === positions[i]) return;
    next ??= { ...table };
    next[n] = placedAt(was, parent, positions[i]!);
  });
  return next ? withTable(places, profileId, next) : places;
}

export function withLeafPages(places: PinPlaces, profileId: string, entering: Pick<Tab, "id" | "pinKey" | "url" | "title">[]): PinPlaces {
  const table = tableOf(places, profileId);
  let next: PinTable | null = null;
  for (const t of entering) {
    const node = tabNode(pinKeyOf(t));
    const place = (next ?? table)[node];
    if (!place || !inFolder(place.parent)) continue;
    const entry: PinPlace = t.url ? { parent: place.parent, pos: place.pos, url: t.url, title: t.title } : { parent: place.parent, pos: place.pos };
    if (entry.url === place.url && entry.title === place.title) continue;
    next ??= { ...table };
    next[node] = entry;
  }
  return next ? withTable(places, profileId, next) : places;
}

export function dropNodes(places: PinPlaces, profileId: string, nodes: string[]): PinPlaces {
  const table = places[profileId];
  if (!table || !nodes.some((n) => table[n])) return places;
  const next = { ...table };
  for (const n of nodes) delete next[n];
  return { ...places, [profileId]: next };
}

export function promoteChildren(places: PinPlaces, profileId: string, folder: string): PinPlaces {
  const table = tableOf(places, profileId);
  const own = table[folder];
  if (!own) return places;
  const kids = siblingsOf(table, folder);
  const below = new Set([...kids, ...descendantsOf(table, kids)]);
  const target = own.parent !== null && below.has(own.parent) ? null : own.parent;
  const peers = siblingsOf(table, target).filter((n) => n !== folder);
  const at = Math.max(siblingsOf(table, target).indexOf(folder), 0);
  const seq = [...peers.slice(0, at), ...kids, ...peers.slice(at)];
  const kidSet = new Set(kids);
  const positions = assignPositions(seq.map((n) => (kidSet.has(n) ? undefined : table[n]!.pos)));
  const next = { ...table };
  delete next[folder];
  seq.forEach((n, i) => {
    if (kidSet.has(n) || next[n]!.pos !== positions[i]) next[n] = placedAt(next[n], target, positions[i]!);
  });
  return withTable(places, profileId, next);
}

type Instances = { tabs: Map<string, string>; groups: Map<string, string> };

export function instancesIn(s: Pick<BrowserState, "tabs" | "groups">, w: BrowserWindow, profileId: string, table: PinTable): Instances {
  const tabs = new Map<string, string>();
  for (const id of w.tabIds) {
    const t = s.tabs[id];
    if (!t || t.profileId !== profileId || t.liveItem) continue;
    const node = tabNode(pinKeyOf(t));
    if (table[node] && !tabs.has(node)) tabs.set(node, id);
  }
  const groups = new Map<string, string>();
  for (const g of Object.values(s.groups)) {
    if (g.windowId !== w.id || g.profileId !== profileId || !g.pinned) continue;
    const node = groupNode(pinKeyOf(g));
    if (table[node] && !groups.has(node)) groups.set(node, g.id);
  }
  return { tabs, groups };
}

export function nodesExisting(s: Pick<BrowserState, "tabs" | "groups" | "parkedPins">, profileId: string): (node: string) => boolean {
  const tabKeys = new Set<string>();
  const groupKeys = new Set<string>();
  for (const t of Object.values(s.tabs)) if (t.profileId === profileId && !t.liveItem) tabKeys.add(pinKeyOf(t));
  for (const g of Object.values(s.groups)) if (g.profileId === profileId && g.pinned) groupKeys.add(pinKeyOf(g));
  const park = s.parkedPins[profileId];
  for (const p of park?.tabs ?? []) tabKeys.add(p.id);
  for (const g of park?.groups ?? []) groupKeys.add(g.id);
  return (node) => (isTabNode(node) ? tabKeys.has(keyOfNode(node)) : isGroupNode(node) ? groupKeys.has(keyOfNode(node)) : true);
}

export function splitNodes(s: Pick<BrowserState, "tabs" | "windows" | "splits">, profileId: string, nodes: string[]): string[] {
  const families = new Map<string, string[]>();
  for (const split of Object.values(s.splits)) {
    const panes = split.tabIds.map((id) => s.tabs[id]);
    if (panes.length < 2 || panes.some((t) => !t || t.profileId !== profileId || t.windowId !== split.windowId || t.liveItem)) continue;
    if (!panes.every((t) => !t!.pinned) && !panes.every((t) => t!.pinnedAsRow)) continue;
    const ids = new Set(split.tabIds);
    const order = (s.windows[split.windowId]?.tabIds ?? split.tabIds).filter((id) => ids.has(id)).map((id) => tabNode(pinKeyOf(s.tabs[id]!)));
    for (const node of order) if (!families.has(node)) families.set(node, order);
  }
  return [...new Set(nodes.flatMap((node) => families.get(node) ?? [node]))];
}

type Projection = { order: string[]; members: Map<string, string[]>; parents: Map<string, string | undefined>; flags: Map<string, "tile" | "row" | "leaf"> };

function projectProfile(s: Pick<BrowserState, "tabs" | "groups" | "parkedPins" | "splits">, w: BrowserWindow, profileId: string, table: PinTable): Projection {
  const inst = instancesIn(s, w, profileId, table);
  const unplacedLive: string[] = [];
  for (const id of w.tabIds) {
    const folderId = s.tabs[id]?.profileId === profileId ? s.tabs[id]!.liveItem?.folderId : undefined;
    if (folderId && !table[liveNode(folderId)] && !unplacedLive.includes(liveNode(folderId))) unplacedLive.push(liveNode(folderId));
  }
  const tree = pinTree(table, nodesExisting(s, profileId), unplacedLive);
  const order: string[] = [];
  const members = new Map<string, string[]>();
  const flags = new Map<string, "tile" | "row" | "leaf">();
  const parents = new Map<string, string | undefined>();
  for (const n of tree.children.get(FAVORITES) ?? []) {
    const id = inst.tabs.get(n);
    if (id) (order.push(id), flags.set(id, "tile"));
  }
  const itemsOf = (folderId: string) =>
    w.tabIds.filter((id) => {
      const t = s.tabs[id];
      return !!t && t.profileId === profileId && !t.pinned && t.liveItem?.folderId === folderId;
    });
  const families = new Map<string, string[]>();
  for (const split of Object.values(s.splits)) {
    if (split.windowId !== w.id) continue;
    const nodes = w.tabIds.filter((id) => split.tabIds.includes(id)).map((id) => s.tabs[id]).filter((t): t is Tab => !!t && t.profileId === profileId).map((t) => tabNode(pinKeyOf(t)));
    if (nodes.length < 2 || nodes.some((node) => !tree.parent.has(node) || tree.parent.get(node) !== tree.parent.get(nodes[0]!))) continue;
    for (const node of nodes) families.set(node, nodes);
  }
  const visit = (parent: string | null, ancestors: string[] = []) => {
    const seen = new Set<string>();
    const siblings = (tree.children.get(parent) ?? []).flatMap((node) => {
      if (seen.has(node)) return [];
      const nodes = families.get(node) ?? [node];
      nodes.forEach((n) => seen.add(n));
      return nodes;
    });
    for (const n of siblings) {
      if (isTabNode(n)) {
        const id = inst.tabs.get(n);
        if (!id) continue;
        order.push(id);
        flags.set(id, parent === null ? "row" : "leaf");
        for (const gid of ancestors) members.get(gid)!.push(id);
      } else if (isGroupNode(n)) {
        const gid = inst.groups.get(n);
        if (gid) {
          if (!members.has(gid)) members.set(gid, []);
          parents.set(gid, parent !== null ? inst.groups.get(parent) : undefined);
        }
        visit(n, gid ? [...ancestors, gid] : ancestors);
      } else if (isLiveNode(n)) order.push(...itemsOf(keyOfNode(n)));
    }
  };
  visit(null);
  return { order, members, parents, flags };
}

const homeOf = (t: Tab) => t.pinnedUrl || t.url || null;

function flagged(t: Tab, kind: "tile" | "row" | "leaf"): Tab {
  const pinned = kind !== "leaf";
  const row = kind === "row";
  const pinnedUrl = pinned ? homeOf(t) : null;
  const folder = kind === "tile" ? t.tileFolder : undefined;
  if (t.pinned === pinned && !!t.pinnedAsRow === row && t.pinnedUrl === pinnedUrl && t.tileFolder === folder) return t;
  const { pinnedAsRow: _, tileFolder: _folder, ...rest } = t;
  return { ...rest, pinned, pinnedUrl, ...(row ? { pinnedAsRow: true as const } : {}), ...(folder ? { tileFolder: folder } : {}) };
}

export function settleWindow(s: BrowserState, windowId: string): BrowserState {
  const w = s.windows[windowId];
  if (!w) return s;
  const profiles: string[] = [];
  for (const id of w.tabIds) {
    const p = s.tabs[id]?.profileId;
    if (p && !profiles.includes(p)) profiles.push(p);
  }
  for (const g of Object.values(s.groups)) if (g.windowId === windowId && g.pinned && !profiles.includes(g.profileId)) profiles.push(g.profileId);
  let tabs = s.tabs;
  let groups = s.groups;
  const head: string[] = [];
  const placed = new Set<string>();
  for (const profileId of profiles) {
    const table = s.pinPlace[profileId];
    const proj = table ? projectProfile(s, w, profileId, table) : null;
    if (proj) {
      for (const [id, kind] of proj.flags) {
        const t = tabs[id]!;
        const next = flagged(t, kind);
        if (next !== t) {
          if (tabs === s.tabs) tabs = { ...s.tabs };
          tabs[id] = next;
        }
      }
      for (const [gid, ids] of proj.members) {
        const g = groups[gid]!;
        const parentId = proj.parents.get(gid);
        if (g.parentId === parentId && g.tabIds.length === ids.length && g.tabIds.every((id, i) => id === ids[i])) continue;
        if (groups === s.groups) groups = { ...s.groups };
        const { parentId: _, ...rest } = g;
        groups[gid] = { ...rest, tabIds: ids, ...(parentId ? { parentId } : {}) };
      }
      for (const id of proj.order) (head.push(id), placed.add(id));
    }
    for (const id of w.tabIds) {
      const t = tabs[id];
      if (t && t.profileId === profileId && t.pinned && !placed.has(id)) (head.push(id), placed.add(id));
    }
  }
  if (groups !== s.groups) {
    const claimed = new Set([...placed].filter((id) => !tabs[id]!.pinned));
    for (const g of Object.values(groups)) {
      if (g.windowId !== windowId || g.pinned) continue;
      if (!g.tabIds.some((id) => claimed.has(id))) continue;
      if (groups === s.groups) groups = { ...s.groups };
      groups[g.id] = { ...g, tabIds: g.tabIds.filter((id) => !claimed.has(id)) };
    }
  }
  const tabIds = [...head, ...w.tabIds.filter((id) => !placed.has(id))];
  const sameOrder = tabIds.every((id, i) => id === w.tabIds[i]);
  if (sameOrder && tabs === s.tabs && groups === s.groups) return s;
  return { ...s, tabs, groups, windows: sameOrder ? s.windows : { ...s.windows, [windowId]: { ...w, tabIds } } };
}

export function settlePlacement(s: BrowserState): BrowserState {
  let next = s;
  for (const id of Object.keys(s.windows)) next = settleWindow(next, id);
  return next;
}

const PLACE_FIELDS = ["pinned", "pinnedAsRow", "pinKey", "windowId", "profileId", "liveItem", "tileFolder"] as const;

export function placementMayDiffer(s: Pick<BrowserState, "tabs" | "groups" | "windows" | "pinPlace" | "parkedPins" | "splits">, prev: typeof s): boolean {
  if (s.splits !== prev.splits || s.pinPlace !== prev.pinPlace || s.windows !== prev.windows || s.parkedPins !== prev.parkedPins) return true;
  if (s.groups !== prev.groups) for (const id of changedIds(s.groups, prev.groups)) {
    const a = s.groups[id];
    const b = prev.groups[id];
    if (!a || !b || a.tabIds !== b.tabIds || a.parentId !== b.parentId || a.pinned !== b.pinned || a.windowId !== b.windowId || a.profileId !== b.profileId || a.pinKey !== b.pinKey) return true;
  }
  if (s.tabs === prev.tabs) return false;
  for (const id of new Set([...Object.keys(s.tabs), ...Object.keys(prev.tabs)])) {
    const a = s.tabs[id];
    const b = prev.tabs[id];
    if (a === b) continue;
    if (!a || !b) return true;
    if (PLACE_FIELDS.some((f) => a[f] !== b[f])) return true;
  }
  return false;
}

type LegacyLiveFolder = { id: string; profileId: string; after?: string | null };

type MigrationSource = Pick<BrowserState, "tabs" | "groups"> & Partial<Pick<BrowserState, "splits">>;

function legacyTable(windows: BrowserWindow[], s: MigrationSource, profileId: string, park: ParkedPins | undefined): PinTable {
  const table: PinTable = {};
  const sequences = new Map<string | null, string[]>();
  const seen = new Set<string>();
  const add = (node: string, parent: string | null, page?: Pick<Tab, "url" | "title">) => {
    if (seen.has(node)) return;
    seen.add(node);
    sequences.set(parent, [...(sequences.get(parent) ?? []), node]);
    table[node] = { parent, pos: "", ...(page ? { url: page.url, title: page.title } : {}) };
  };
  const collect = (definitions: { node: string; parent: string | null; ids: string[] }[], tabs: { id: string; node: string; pinned: boolean; row: boolean; url: string; title: string; group?: string }[]) => {
    const looks: PinTable = Object.fromEntries(definitions.map((g) => [g.node, { parent: g.parent, pos: "" }]));
    const tree = pinTree(looks, (node) => !!looks[node]);
    const depth = new Map(definitions.map((g) => [g.node, ancestorsOf(tree, g.node).length]));
    const memberOf = new Map<string, string>();
    for (const g of [...definitions].sort((a, z) => depth.get(a.node)! - depth.get(z.node)!)) for (const id of g.ids) memberOf.set(id, g.node);
    const enter = (node: string) => {
      if (seen.has(node)) return;
      const parent = tree.parent.get(node) ?? null;
      if (parent) enter(parent);
      add(node, parent);
    };
    for (const t of tabs) {
      if (t.pinned) add(t.node, t.row ? null : FAVORITES);
      else {
        const parent = t.group ?? memberOf.get(t.id);
        if (!parent || !looks[parent]) continue;
        enter(parent);
        add(t.node, parent, t);
      }
    }
    for (const g of definitions) enter(g.node);
  };
  for (const w of windows) {
    const own = Object.values(s.groups).filter((g) => g.windowId === w.id && g.profileId === profileId && g.pinned);
    const groups = new Map(own.map((g) => [g.id, g]));
    const paired = new Set(Object.values(s.splits ?? {}).filter((v) => v.windowId === w.id).flatMap((v) => v.tabIds));
    const definitions = own.map((g) => ({ node: groupNode(pinKeyOf(g)), parent: g.parentId && groups.has(g.parentId) ? groupNode(pinKeyOf(groups.get(g.parentId)!)) : null, ids: g.tabIds }));
    const tabs = w.tabIds.flatMap((id) => {
      const t = s.tabs[id];
      return !t || t.profileId !== profileId || t.liveItem ? [] : [{ id, node: tabNode(pinKeyOf(t)), pinned: t.pinned, row: !!t.pinnedAsRow || paired.has(id), url: t.url, title: t.title }];
    });
    collect(definitions, tabs);
  }
  if (park) {
    const groups = new Set(park.groups.map((g) => g.id));
    const paired = new Set((park.splits ?? []).flatMap((v) => v.ids));
    collect(
      park.groups.map((g) => ({ node: groupNode(g.id), parent: g.parentId && groups.has(g.parentId) ? groupNode(g.parentId) : null, ids: park.tabs.filter((t) => t.groupId === g.id).map((t) => t.id) })),
      park.tabs.map((t) => ({ id: t.id, node: tabNode(t.id), pinned: !t.groupId, row: !!t.pinnedAsRow || paired.has(t.id), url: t.url, title: t.title, ...(t.groupId ? { group: groupNode(t.groupId) } : {}) })),
    );
  }
  for (const [parent, nodes] of sequences) {
    const positions = assignPositions(nodes.map(() => undefined));
    nodes.forEach((node, i) => { table[node] = { ...table[node]!, parent, pos: positions[i]! }; });
  }
  return table;
}

export function migrateLivePlaces(places: PinPlaces, folders: LegacyLiveFolder[]): PinPlaces {
  let next = places;
  const slots = new Map<string, Map<string | null, string[]>>();
  for (const f of folders) {
    const table = tableOf(places, f.profileId);
    if (table[liveNode(f.id)]) continue;
    const roots = siblingsOf(table, null);
    const at = f.after ? roots.indexOf(f.after) : -1;
    const before = f.after === null ? roots[0] ?? null : at >= 0 ? roots[at + 1] ?? null : null;
    const profile = slots.get(f.profileId) ?? new Map<string | null, string[]>();
    profile.set(before, [...(profile.get(before) ?? []), liveNode(f.id)]);
    slots.set(f.profileId, profile);
  }
  for (const [profileId, positions] of slots) for (const [before, nodes] of positions) next = placeNodes(next, profileId, nodes, null, before);
  return next;
}

export function migratedPlaces(s: Pick<BrowserState, "tabs" | "groups" | "windows" | "windowOrder" | "parkedPins" | "profiles"> & Partial<Pick<BrowserState, "splits">>, saved: PinPlaces | undefined, folders: LegacyLiveFolder[] = []): PinPlaces {
  let out: PinPlaces = { ...(saved ?? {}) };
  const order = [...s.windowOrder, ...Object.keys(s.windows).filter((id) => !s.windowOrder.includes(id))]
    .map((id) => s.windows[id])
    .filter((w): w is BrowserWindow => !!w && !w.incognito && w.kind !== "small");
  for (const profileId of Object.keys(s.profiles)) {
    if (out[profileId]) continue;
    const holders = order.filter((w) => w.tabIds.some((id) => s.tabs[id]?.profileId === profileId) || Object.values(s.groups).some((g) => g.windowId === w.id && g.profileId === profileId && g.pinned));
    const table = legacyTable(holders, s, profileId, s.parkedPins[profileId]);
    if (Object.keys(table).length) out[profileId] = table;
    out = migrateLivePlaces(out, folders.filter((f) => f.profileId === profileId));
  }
  return out;
}

export function trackLeafAddresses(s: Pick<BrowserState, "tabs" | "pinPlace">, prev: Pick<BrowserState, "tabs">): PinPlaces {
  if (s.tabs === prev.tabs) return s.pinPlace;
  let places = s.pinPlace;
  for (const id of changedIds(s.tabs, prev.tabs)) {
    const t = s.tabs[id];
    const was = prev.tabs[id];
    if (!t || !was || t.liveItem || t.pinned || t.pageIn || was.pageIn) continue;
    const table = places[t.profileId];
    const node = tabNode(pinKeyOf(t));
    const place = table?.[node];
    if (!place || place.parent === null || place.parent === FAVORITES) continue;
    let next = place;
    if (t.url && t.url !== was.url && t.url !== place.url) next = { ...next, url: t.url, title: t.title !== was.title ? t.title : "" };
    else if (t.title && t.title !== was.title && t.url === (next.url ?? t.url) && t.title !== next.title) next = { ...next, title: t.title };
    if (next !== place) places = withTable(places, t.profileId, { ...tableOf(places, t.profileId), [node]: next });
  }
  return places;
}

import { assignPositions } from "../../platform/sync";
import type { BrowserState } from "../browser/store";
import { isPinnedRow, pinKeyOf, ROW_PIN, TILE_PIN } from "../browser/model";
import type { BrowserWindow, ParkedPins, Tab, TabGroup, TabPin } from "../browser/types";
import { splitTabIds } from "../splits/splits";

export type PinPlace = { parent: string | null; pos: string; url?: string; title?: string };
export type PinTable = Record<string, PinPlace>;
export type PinPlaces = Record<string, PinTable>;

export const FAVORITES = "fav";

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
  if (!was || was.url === undefined) return { parent, pos };
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

export function withLeafPages(places: PinPlaces, profileId: string, entering: Pick<Tab, "id" | "pinKey" | "url" | "title" | "pinnedUrl">[]): PinPlaces {
  const table = tableOf(places, profileId);
  let next: PinTable | null = null;
  for (const t of entering) {
    const node = tabNode(pinKeyOf(t));
    const place = (next ?? table)[node];
    const home = t.pinnedUrl || t.url;
    if (!place || !inFolder(place.parent) || !home || place.url === home) continue;
    const entry: PinPlace = { parent: place.parent, pos: place.pos, url: home, title: t.url === home ? t.title : "" };
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
    const paneIds = splitTabIds(split);
    const panes = paneIds.map((id) => s.tabs[id]);
    if (panes.length < 2 || panes.some((t) => !t || t.profileId !== profileId || t.windowId !== split.windowId || t.liveItem)) continue;
    if (!panes.every((t) => !t!.pin) && !panes.every((t) => isPinnedRow(t))) continue;
    const ids = new Set(paneIds);
    const order = (s.windows[split.windowId]?.tabIds ?? paneIds).filter((id) => ids.has(id)).map((id) => tabNode(pinKeyOf(s.tabs[id]!)));
    for (const node of order) if (!families.has(node)) families.set(node, order);
  }
  return [...new Set(nodes.flatMap((node) => families.get(node) ?? [node]))];
}

type LegacyLiveFolder = { id: string; profileId: string; after?: string | null };

type MigrationSource = Pick<BrowserState, "tabs" | "groups"> & Partial<Pick<BrowserState, "splits">>;

const homePage = (t: { url: string; title: string; pinnedUrl?: string | null }) => ({ url: t.pinnedUrl || t.url, title: !t.pinnedUrl || t.pinnedUrl === t.url ? t.title : "" });

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
    const paired = new Set(Object.values(s.splits ?? {}).filter((v) => v.windowId === w.id).flatMap((v) => splitTabIds(v)));
    const definitions = own.map((g) => ({ node: groupNode(pinKeyOf(g)), parent: g.parentId && groups.has(g.parentId) ? groupNode(pinKeyOf(groups.get(g.parentId)!)) : null, ids: g.tabIds }));
    const tabs = w.tabIds.flatMap((id) => {
      const t = s.tabs[id];
      return !t || t.profileId !== profileId || t.liveItem ? [] : [{ id, node: tabNode(pinKeyOf(t)), pinned: !!t.pin, row: isPinnedRow(t) || paired.has(id), ...homePage(t) }];
    });
    collect(definitions, tabs);
  }
  if (park) {
    const groups = new Set(park.groups.map((g) => g.id));
    const paired = new Set((park.splits ?? []).flatMap((v) => splitTabIds(v)));
    collect(
      park.groups.map((g) => ({ node: groupNode(g.id), parent: g.parentId && groups.has(g.parentId) ? groupNode(g.parentId) : null, ids: park.tabs.filter((t) => t.groupId === g.id).map((t) => t.id) })),
      park.tabs.map((t) => ({ id: t.id, node: tabNode(t.id), pinned: !t.groupId, row: isPinnedRow(t) || paired.has(t.id), ...homePage(t), ...(t.groupId ? { group: groupNode(t.groupId) } : {}) })),
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
    .filter((w): w is BrowserWindow => w?.kind === "main");
  for (const profileId of Object.keys(s.profiles)) {
    if (out[profileId]) continue;
    const holders = order.filter((w) => w.tabIds.some((id) => s.tabs[id]?.profileId === profileId) || Object.values(s.groups).some((g) => g.windowId === w.id && g.profileId === profileId && g.pinned));
    const table = legacyTable(holders, s, profileId, s.parkedPins[profileId]);
    if (Object.keys(table).length) out[profileId] = table;
    out = migrateLivePlaces(out, folders.filter((f) => f.profileId === profileId));
  }
  return out;
}

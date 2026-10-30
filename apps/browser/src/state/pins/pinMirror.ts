import type { BrowserState } from "../browser/store";
import { changedIds } from "../browser/changes";
import { ancestorIds, depthOf, orderSections } from "../groups/groups";
import { IDLE_LIVE, isIncognitoProfile, isPinnedRow, makeTab, pinKeyOf, pinSection, TILE_PIN } from "../browser/model";
import { ASLEEP, hasPage } from "../tabs/pageSession";
import { mapSlotIds, splitTabIds, stackAt } from "../splits/splits";
import { sharedListTab, sharesTabs } from "../tabs/tabShare";
import { removeTabs } from "../tabs/tabs";
import type { BrowserWindow, SplitView, Tab, TabGroup } from "../browser/types";
import { samePage } from "../../lib/url";
import { isRegularWindow } from "../windows/small";
import { tileFolderOf } from "./tileFolders";
import type { PinPlace } from "./pinTree";

export const homeOf = (t: { url: string; pinnedUrl?: string | null }) => t.pinnedUrl || t.url;

type Item = { tab: Tab; group: string | null };
type Section = { items: Item[]; groups: Map<string, { group: TabGroup; parent: string | null }>; own: TabGroup[]; duplicate?: boolean; splits?: PinnedSplit[] };
type PinnedSplit = Pick<SplitView, "orientation" | "slots">;

const isTile = (t: Tab) => pinSection(t) === "tile";

export function withSplits(s: Pick<BrowserState, "splits">, w: BrowserWindow, x: Section): Section {
  const keyOf = new Map(x.items.filter((i) => !isTile(i.tab)).map((i) => [i.tab.id, pinKeyOf(i.tab)]));
  const splits = Object.values(s.splits)
    .filter((v) => v.windowId === w.id && splitTabIds(v).every((id) => keyOf.has(id)))
    .map(({ orientation, slots }): PinnedSplit => ({ orientation, slots: mapSlotIds(slots, (id) => keyOf.get(id)!) }));
  return { ...x, splits };
}

const splitSig = (v: PinnedSplit) => `S${splitTabIds(v).join("\u0003")}\u0001${v.orientation}\u0001${stackAt(v) < 0 ? "" : stackAt(v)}`;

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
    const g = t.pin ? undefined : inner.get(id);
    if (member ? !member(t) : !t.pin && !g) continue;
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
  `${pinKeyOf(t)}\u0001${t.pinnedUrl ?? ""}\u0001${t.customTitle ?? ""}\u0001${t.customIcon ?? ""}\u0001${isPinnedRow(t) ? "r" : ""}\u0001${tileFolderOf(t)?.id ?? ""}\u0001${tileFolderOf(t)?.name ?? ""}\u0001${tileFolderOf(t)?.renamedAt ?? ""}`;
const memberSig = (t: Tab) => `${pinKeyOf(t)}\u0001${t.pinnedUrl ?? ""}\u0001${t.customTitle ?? ""}\u0001${t.customIcon ?? ""}`;
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

export const pinnedGroupsOf = (s: Pick<BrowserState, "groups">) => Object.values(s.groups).filter((g) => g.pinned);

export function hasDuplicates(x: Section): boolean {
  const tabs = x.items.map((i) => pinKeyOf(i.tab));
  return !!x.duplicate || new Set(tabs).size < tabs.length;
}

const PIN_FIELDS = ["pin", "pinnedUrl", "customTitle", "customIcon", "profileId", "windowId", "pinKey", "liveItem"] as const;
function pinnedSplitsChanged(s: BrowserState, prev: BrowserState): boolean {
  if (s.splits === prev.splits) return false;
  const members = new Set(pinnedGroupsOf(s).flatMap((g) => g.tabIds));
  const pinnedPane = (id: string) => !!s.tabs[id]?.pin || !!prev.tabs[id]?.pin || members.has(id);
  return [...Object.values(s.splits), ...Object.values(prev.splits)].some((v) => splitTabIds(v).some(pinnedPane));
}

export function pinsMayDiffer(s: BrowserState, prev: BrowserState): boolean {
  if (s.windows !== prev.windows || s.groups !== prev.groups || pinnedSplitsChanged(s, prev)) return true;
  if (s.tabs === prev.tabs) return false;
  let members: Set<string> | null = null;
  for (const id of changedIds(s.tabs, prev.tabs)) {
    const a = s.tabs[id];
    const b = prev.tabs[id];
    if (!a || !b) {
      if (a?.pin || b?.pin) return true;
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
    const paired = new Set((x.splits ?? []).flatMap((v) => splitTabIds(v)));
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
    for (const v of x.splits ?? []) if (!spec.splits!.some((u) => splitTabIds(u).some((k) => splitTabIds(v).includes(k)))) spec.splits!.push(v);
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
      pin: tile ? (src.pin ?? TILE_PIN) : null,
      pinnedUrl: src.pinnedUrl || (tile ? src.url : null) || null,
      customTitle: src.customTitle,
      customIcon: src.customIcon,
      muted: src.muted,
      zoom: src.zoom,
    }),
    pinKey: pinKeyOf(src),
    page: ASLEEP,
  };
}

export function settleMovedPins(before: BrowserState, after: BrowserState, moved: string[], targetId: string): BrowserState {
  if (!isRegularWindow(after.windows[targetId])) return after;
  const memberOf = innermostPinned(before, pinnedGroupsOf(before));
  const pins = moved
    .map((id) => before.tabs[id])
    .filter((t): t is Tab => !!t && (t.pin || memberOf.has(t.id) || sharedListTab(before, t)) && t.windowId !== targetId && after.tabs[t.id]?.windowId === targetId);
  if (!pins.length) return after;
  const tabs = { ...after.tabs };
  const live = { ...after.live };
  const windows = { ...after.windows };
  const groups = { ...after.groups };
  for (const sourceId of new Set(pins.map((t) => t.windowId))) {
    const src = windows[sourceId];
    if (!isRegularWindow(src) || !isRegularWindow(before.windows[sourceId])) continue;
    const swap = new Map<string, string>();
    const shown = before.windows[sourceId]!.activeTabIds;
    let activeTabIds = src.activeTabIds;
    for (const t of pins) {
      if (t.windowId !== sourceId) continue;
      const copy = copyOf(t, sourceId, !!t.pin);
      tabs[copy.id] = copy;
      live[copy.id] = IDLE_LIVE;
      swap.set(t.id, copy.id);
      if (shown[t.profileId] === t.id && !t.pin && !memberOf.has(t.id)) activeTabIds = { ...activeTabIds, [t.profileId]: copy.id };
    }
    const present = new Set([...src.tabIds, ...swap.values()]);
    const keep = (ids: string[]) => ids.map((id) => swap.get(id) ?? id).filter((id) => present.has(id));
    for (const g of sharesTabs(before) ? Object.values(before.groups) : pinnedGroupsOf(before)) {
      if (g.windowId === sourceId && g.tabIds.some((id) => swap.has(id))) groups[g.id] = { ...g, ...groups[g.id], tabIds: keep(g.tabIds) };
    }
    windows[sourceId] = { ...src, tabIds: orderSections(keep(before.windows[sourceId]!.tabIds), tabs, groups), ...(activeTabIds !== src.activeTabIds ? { activeTabIds } : {}) };
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
  windows[targetId] = { ...target, tabIds: orderSections(tabIds, tabs, groups) };
  const next: BrowserState = { ...after, tabs, live, windows, groups };
  return gone.length ? removeTabs(next, gone, false) : next;
}

export const homeTitle = (place: PinPlace | undefined, home: string) => (place?.url === home && place.title !== undefined ? place.title : undefined);
